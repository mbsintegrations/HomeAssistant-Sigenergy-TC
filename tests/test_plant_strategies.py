"""Native strategy actions stay owner/plant/revision bound without write replay."""

from copy import deepcopy

import pytest

from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.plant_configuration import PlantConfiguration
from custom_components.sigen_hybrid.core.plant_strategies import CHAT, PERSONAL, PlantStrategies, decode_answer


class Client:
    station_id = "42"

    def __init__(self):
        self.calls = []
        self.rules = [{"personalizationRuleId": 17, "personalizationRuleName": "Night charge", "customDisplayName": "",
                       "ruleCondition": "Every day 02:00-05:00, SOC <= 40%", "ruleEffect": "Force charge"}]
        self.mode = 0
        self.fail = False
        self.confirm = True
        self.answer = [{"type": "proposal_card", "payload": {"cards": [{"ruleCondition": "02:00-04:00", "ruleEffect": "Force charge"}],
            },
            "buttons": [{"id": "btn_confirm_apply", "text": "Apply proposal", "type": "button", "action": "CONFIRM_APPLY_PROPOSAL",
                         "payload": {"stationId": "42", "proposalId": "native-proposal", "proposalStage": "FINAL_CONFIRM"}}]}]
        self.sent = 0
        self.streaming = False
        self.foreign = False

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, deepcopy(kwargs)))
        if path == "device/energy-profile/mode/current/42":
            return {"currentMode": self.mode, "currentProfileId": -1}
        if path == PERSONAL+"rules":
            return {"personalizationRulesList": deepcopy(self.rules)}
        if path.startswith(PERSONAL+"rule/"):
            if self.fail:
                raise TimeoutError
            if self.confirm:
                if path.endswith("/delete"):
                    self.rules.clear()
                else:
                    self.rules[0]["customDisplayName"] = kwargs["json"]["customDisplayName"]
            return {"success": True}
        if path == CHAT+"message/send":
            self.sent += 1
            if self.fail:
                raise TimeoutError
            return {"sessionId": "session-one", "conversationId": f"turn-{self.sent}"}
        if path == CHAT+"thread/detail":
            return {"records": [{"sessionId": "somebody-else" if self.foreign else "session-one", "conversationId": f"turn-{self.sent}",
                                 "answer": deepcopy(self.answer), "streaming": self.streaming, "interrupted": False}]}
        raise AssertionError((method, path, kwargs))


def setup():
    client, records, now = Client(), [], [0]
    async def save(value):
        records.append(deepcopy(value))
    backend = PlantStrategies(PlantConfiguration(client, "42", clock=lambda: now[0]), save, clock=lambda: now[0])
    return client, records, now, backend


@pytest.mark.parametrize("action", ["rename", "delete"])
async def test_direct_actions_snapshot_before_post_and_confirm_with_fresh_native_readback(action):
    client, records, _, backend = setup()
    preview = await backend.preview("owner", action, rule_id=17, name="My night charge")
    assert not records and all(path != PERSONAL+"rule/delete" for _, path, _ in client.calls)
    original = client._data
    async def data(method, path, **kwargs):
        if path.startswith(PERSONAL+"rule/"):
            assert records[-1]["phase"] == "sending" and records[-1]["before"]["rules"][0]["personalizationRuleId"] == 17
        return await original(method, path, **kwargs)
    client._data = data
    result = await backend.apply("owner", preview["preview"])
    assert result["phase"] == "confirmed" and records[-1]["phase"] == "confirmed"
    write = next(call for call in client.calls if call[1].startswith(PERSONAL+"rule/"))
    assert write[0] == "POST" and write[2]["json"]["stationId"] == 42
    assert write[2]["json"]["personalizationRuleId"] == 17
    if action == "rename":
        assert result["rules"]["rules"][0]["customDisplayName"] == "My night charge"
    else:
        assert result["rules"]["rules"] == []


async def test_foreign_missing_duplicate_ids_and_unknown_actions_never_send_a_write():
    client, _, _, backend = setup()
    for action, rule in (("delete", 18), ("edit", True), ("create", 17), ("unknown", 17)):
        with pytest.raises(SafetyError):
            await backend.preview("owner", action, rule_id=rule, instruction="Charge at night")
    client.rules.append(deepcopy(client.rules[0]))
    with pytest.raises(SafetyError):
        await backend.preview("owner", "delete", rule_id=17)
    assert all(path in ("device/energy-profile/mode/current/42", PERSONAL+"rules") for _, path, _ in client.calls)


async def test_previews_are_owner_bound_expire_and_reject_changed_rule_or_mode():
    client, records, now, backend = setup()
    preview = await backend.preview("owner", "delete", rule_id=17)
    with pytest.raises(SafetyError):
        await backend.apply("another-user", preview["preview"])
    client.rules[0]["ruleCondition"] = "Owner changed it"
    with pytest.raises(SafetyError, match="changed"):
        await backend.apply("owner", preview["preview"])
    preview = await backend.preview("owner", "delete", rule_id=17)
    client.mode = 1
    with pytest.raises(SafetyError, match="changed"):
        await backend.apply("owner", preview["preview"])
    preview = await backend.preview("owner", "delete", rule_id=17)
    now[0] = 601
    with pytest.raises(SafetyError):
        await backend.apply("owner", preview["preview"])
    assert not records


async def test_timeout_consumes_the_preview_and_retains_the_snapshot_without_retry_or_rollback():
    client, records, _, backend = setup()
    preview = await backend.preview("owner", "delete", rule_id=17)
    client.fail = True
    with pytest.raises(TimeoutError):
        await backend.apply("owner", preview["preview"])
    with pytest.raises(SafetyError):
        await backend.apply("owner", preview["preview"])
    assert len([path for _, path, _ in client.calls if path.endswith("/delete")]) == 1
    assert records[-1]["phase"] == "sending" and records[-1]["before"]["rules"]


async def test_success_response_without_matching_readback_is_never_reported_confirmed():
    client, records, _, backend = setup()
    client.confirm = False
    preview = await backend.preview("owner", "rename", rule_id=17, name="Changed")
    result = await backend.apply("owner", preview["preview"])
    assert result["phase"] == records[-1]["phase"] == "unconfirmed"


async def test_mode_change_during_delete_cannot_confirm_absence_in_a_different_mode():
    client, _, _, backend = setup()
    preview = await backend.preview("owner", "delete", rule_id=17)
    original = client._data
    async def data(method, path, **kwargs):
        result = await original(method, path, **kwargs)
        if path.endswith("/delete"):
            client.mode = 1
        return result
    client._data = data
    assert (await backend.apply("owner", preview["preview"]))["phase"] == "unconfirmed"


async def test_preview_capacity_does_not_lock_out_already_reviewed_actions():
    _, _, _, backend = setup()
    previews = [await backend.preview("owner", "rename", rule_id=17, name="My charging") for _ in range(32)]
    with pytest.raises(SafetyError):
        await backend.preview("owner", "rename", rule_id=17, name="Another")
    assert (await backend.apply("owner", previews[0]["preview"]))["phase"] == "confirmed"


@pytest.mark.parametrize("action", ["create", "edit"])
async def test_native_new_and_change_use_personalization_conversation_never_a_tc_schedule(action):
    client, _, _, backend = setup()
    preview = await backend.preview("owner", action, rule_id=17 if action == "edit" else None, instruction="Charge 02:00 to 05:00")
    result = await backend.apply("owner", preview["preview"])
    assert result["phase"] == "awaiting_response"
    payload = next(kwargs["json"] for _, path, kwargs in client.calls if path == CHAT+"message/send")
    assert payload == {"stationId": "42", "question": "Charge 02:00 to 05:00", "newSession": True,
                       **({"optionalContext": {"selectedStrategyId": 17}} if action == "edit" else {})}
    assert client.rules[0]["personalizationRuleId"] == 17


async def start(backend):
    preview = await backend.preview("owner", "create", instruction="Charge overnight")
    return (await backend.apply("owner", preview["preview"]))["conversation"]


async def test_native_proposal_requires_explicit_response_and_is_not_replayed():
    client, records, _, backend = setup()
    handle = await start(backend)
    result = await backend.read_conversation("owner", handle)
    assert result["phase"] == "response" and not result["plant_changed"]
    assert result["buttons"] == [{"index": 0, "text": "Apply proposal"}]
    assert client.sent == 1  # A proposal or its text never auto-applies.
    with pytest.raises(SafetyError):
        await backend.answer("different-user", handle, button=0)
    result = await backend.answer("owner", handle, button=0)
    assert result["phase"] == "awaiting_response"
    payload = [kwargs["json"] for _, path, kwargs in client.calls if path == CHAT+"message/send"][-1]
    assert payload == {"stationId": "42", "sessionId": "session-one", "question": "Apply proposal",
                       "uiEvent": {"type": "button", "action": "CONFIRM_APPLY_PROPOSAL", "payload": {"stationId": "42", "proposalId": "native-proposal", "proposalStage": "FINAL_CONFIRM"}}}
    with pytest.raises(SafetyError):
        await backend.answer("owner", handle, button=0)
    assert client.sent == 2 and records[-1]["phase"] == "sending_response"


async def test_polling_is_bounded_and_foreign_or_incomplete_records_offer_no_action():
    client, _, now, backend = setup()
    handle = await start(backend)
    client.streaming = True
    result = await backend.read_conversation("owner", handle)
    assert result["phase"] == "awaiting_response" and not result["buttons"]
    calls = len(client.calls)
    await backend.read_conversation("owner", handle)
    assert len(client.calls) == calls
    now[0] += 11
    client.foreign = True
    result = await backend.read_conversation("owner", handle)
    assert result["phase"] == "awaiting_response" and not result["blocks"]
    with pytest.raises(SafetyError):
        await backend.answer("owner", handle, button=0)


async def test_changed_rules_block_stale_ai_proposal_and_unknown_buttons_are_not_executable():
    client, _, _, backend = setup()
    handle = await start(backend)
    client.answer[0]["buttons"].append({"id": "open_external_url", "text": "Link", "type": "url", "action": "open", "payload": {"url": "https://example.invalid"}})
    result = await backend.read_conversation("owner", handle)
    assert len(result["buttons"]) == 1
    client.rules[0]["ruleCondition"] = "Changed in app"
    with pytest.raises(SafetyError, match="changed"):
        await backend.answer("owner", handle, button=0)
    assert client.sent == 1


async def test_uncertain_native_confirmation_cannot_reoffer_or_replay_the_old_proposal():
    client, _, _, backend = setup()
    handle = await start(backend)
    await backend.read_conversation("owner", handle)
    client.fail = True
    with pytest.raises(TimeoutError):
        await backend.answer("owner", handle, button=0)
    result = await backend.read_conversation("owner", handle)
    assert result["phase"] == "unconfirmed" and not result["buttons"]
    with pytest.raises(SafetyError):
        await backend.answer("owner", handle, button=0)
    assert client.sent == 2


async def test_vendor_button_for_another_plant_is_never_executable():
    client, _, _, backend = setup()
    handle = await start(backend)
    client.answer[0]["buttons"][0]["payload"]["stationId"] = "99"
    with pytest.raises(SafetyError, match="different plant"):
        await backend.read_conversation("owner", handle)
    with pytest.raises(SafetyError):
        await backend.answer("owner", handle, button=0)
    assert client.sent == 1


def test_bounded_native_answer_decoding_is_data_not_code_execution():
    assert decode_answer('{"type":"final_result","content":"[{\\"type\\":\\"content\\",\\"message\\":\\"Hi\\"}]"}') == [{"type": "content", "message": "Hi"}]
    assert decode_answer('<script>bad()</script>')[0]["message"] == '<script>bad()</script>'
    with pytest.raises(SafetyError):
        decode_answer('x'*64001)


@pytest.mark.parametrize("blocked", ["not_admin", "unloaded", "demo", "disabled", "closing", "offline", "foreign_plant", "pending_override"])
async def test_websocket_write_boundary_rejects_without_a_strategy_dispatch(monkeypatch, blocked):
    import ast
    import asyncio
    import sys
    import types
    from pathlib import Path
    from types import SimpleNamespace as N

    client, _, _, _ = setup()
    loaded = object()
    class Journal:
        async def pending(self):
            return {"active": True} if blocked == "pending_override" else None
    async def bind():
        return N(journal=Journal())
    owner = N(enabled=True, _closing=blocked == "closing", _job=None, _lock=asyncio.Lock(), operation_lock=asyncio.Lock(), _bind=bind)
    runtime = N(cloud=N(client=client, station_id="43" if blocked == "foreign_plant" else "42", _connected=blocked != "offline"), controls=N(cloud=owner, local=None))
    entry = N(domain="sigen_hybrid", state=object() if blocked == "unloaded" else loaded, entry_id="entry", runtime_data=runtime,
              data={"demo": blocked == "demo"}, options={"cloud": {"station_id": "42"}, "control": {"enabled": blocked != "disabled"}})
    errors, results = [], []
    connection = N(user=N(id="owner", is_admin=blocked != "not_admin"), send_error=lambda _, code, text: errors.append(code), send_result=lambda _, value: results.append(value))
    hass = N(config_entries=N(async_get_entry=lambda _: entry))
    storage = types.ModuleType("homeassistant.helpers.storage")
    storage.Store = lambda *args: N(async_save=None)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.storage", storage)
    tree = ast.parse(Path("custom_components/sigen_hybrid/owner_configuration.py").read_text())
    node = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "websocket_plant_strategy")
    node.decorator_list = []
    scope = {"__name__": "custom_components.sigen_hybrid.owner_configuration", "asyncio": asyncio, "DOMAIN": "sigen_hybrid",
             "ConfigEntryState": N(LOADED=loaded), "SigenError": SafetyError, "PlantConfiguration": PlantConfiguration}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "owner_configuration.py", "exec"), scope)
    await scope["websocket_plant_strategy"](hass, connection, {"id": 1, "config_entry": "entry", "operation": "preview", "action": "delete", "rule_id": 17})
    assert errors and not results and not client.calls
