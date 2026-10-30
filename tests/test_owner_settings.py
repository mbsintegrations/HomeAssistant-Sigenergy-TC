"""Actual owner setting jobs and recovery, against synthetic appliances only."""

import copy

import pytest
from test_control_session import NOW, Appliance
from test_owner_control_runtime import runtime

from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode, Source
from custom_components.sigen_hybrid.core.owner_settings import mode_catalogue


class SettingsAppliance(Appliance):
    def __init__(self):
        super().__init__(lambda: NOW)
        self.mode = {"currentMode": 1, "currentProfileId": -1}
        self.gateway = {"onOffGridStatus": 0, "showButton": True}
        self.chargers = {"AC-A": 4, "AC-B": 4, "DC-A": 4}
        self.disconnect_after_write = False
        self.modes = {"defaultWorkingModes": [
            {"value": "0", "label": "Self-Consumption"}, {"value": "1", "label": "Sigen AI Mode"},
            {"value": "2", "label": "Time-based Control"}, {"value": "5", "label": "Fully Feed-in to Grid"},
            {"value": "7", "label": "Remote EMS Mode"},
        ], "energyProfileItems": [{"profileId": 7, "name": "Synthetic profile"}]}

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path == "device/owner/station/home":
            return {"stationId": 42, "status": 1, "blockClient": False, "onGrid": True,
                    "hasInstantSetting": True, "hasGateway": True, "hasAcCharger": True, "hasEv": True,
                    "acSnList": ["AC-A", "AC-B"], "dcSnList": ["DC-A"]}
        if "/mode/all/" in path:
            return copy.deepcopy(self.modes)
        if "/mode/current/" in path:
            return copy.deepcopy(self.mode)
        if path == "device/gateway/gateway-status":
            return dict(self.gateway)
        if path in ("device/acevse/charge/status", "device/dcevse/status"):
            return self.chargers[kwargs["params"]["snCode"]]
        self.calls.pop()
        return await super()._data(method, path, **kwargs)

    async def _envelope(self, method, path, **kwargs):
        if path.endswith("/mode"):
            self.calls.append((method, path, kwargs))
            value = kwargs["json"]
            self.mode = {"currentMode": value["operationMode"], "currentProfileId": value["profileId"]}
        elif path.endswith("/ongrid-state/update"):
            self.calls.append((method, path, kwargs))
            self.gateway["onOffGridStatus"] = 0 if kwargs["json"]["onGridState"] == 0 else 2
            return {"data": 0}
        elif path.endswith("/charge/start"):
            self.calls.append((method, path, kwargs))
            params = kwargs["params"]
            self.chargers[params["snCode"]] = 3 if params["enable"] == 0 else 4
            return {"data": {"successful": True}}
        else:
            return await super()._envelope(method, path, **kwargs)
        if self.disconnect_after_write:
            self.disconnect_after_write = False
            raise TimeoutError("Synthetic loss after acceptance")
        return {"data": True}


def setup_settings(**kwargs):
    appliance = kwargs.pop("appliance", None) or SettingsAppliance()
    controls, coordinator, _, store, clock, notifications = runtime(appliance=appliance, **kwargs)
    old = appliance._data

    async def read(method, path, **options):
        if path == "device/owner/station/home":
            # runtime() substitutes a minimal manual-only home; expose the real
            # synthetic multi-device response for these integration tests.
            return await SettingsAppliance._data(appliance, method, path, **options)
        return await old(method, path, **options)

    appliance._data = read
    return controls, coordinator, appliance, store, clock


async def submit(controls, key, value, request_id="setting", **kwargs):
    response = await controls.setting(key, value, request_id=request_id, source=Source.MANUAL, dry_run=False, **kwargs)
    assert response["phase"] == "queued"
    await controls._job
    return controls.operation


async def test_mode_job_commits_once_and_duplicate_after_restart_does_not_reapply():
    controls, _, appliance, store, _ = setup_settings()
    value = {"mode": 2, "profile_id": -1}
    assert (await submit(controls, "native_mode", value))["phase"] == "confirmed"
    assert appliance.mode["currentMode"] == 2 and store.value["active"] is None
    assert store.value["history"][-1]["phase"] == "committed"
    writes = sum(method != "GET" for method, *_ in appliance.calls)
    await controls.close()
    restarted, _, _, _, _ = setup_settings(appliance=appliance, store=store)
    assert (await submit(restarted, "native_mode", value))["phase"] == "confirmed"
    assert sum(method != "GET" for method, *_ in appliance.calls) == writes
    await restarted.close()


async def test_setting_preview_is_read_only_and_does_not_create_a_journal():
    controls, _, appliance, store, _ = setup_settings()
    result = await controls.setting("native_mode", {"mode": 0, "profile_id": -1},
                                    request_id="preview", source=Source.MANUAL)
    assert result["phase"] == "preview" and result["before"]["mode"] == 1
    assert store.value is None and not any(method != "GET" for method, *_ in appliance.calls)
    await controls.close()


@pytest.mark.parametrize("value", [{"mode": 5, "profile_id": -1}, {"mode": 8, "profile_id": -1},
                                   {"mode": 9, "profile_id": 999}, {"mode": 0, "profile_id": 77}])
async def test_unapproved_export_or_unadvertised_mode_never_writes(value):
    controls, _, appliance, store, _ = setup_settings()
    assert (await submit(controls, "native_mode", value))["phase"] == "failed"
    assert store.value is None and not any(method != "GET" for method, *_ in appliance.calls)
    await controls.close()


async def test_settings_cannot_change_during_an_active_manual_lease():
    controls, _, appliance, _, _ = setup_settings()
    await controls.submit(Intent(Mode.HOLD))
    await controls._job
    writes = sum(method != "GET" for method, *_ in appliance.calls)
    assert (await submit(controls, "native_mode", {"mode": 0, "profile_id": -1}))["phase"] == "failed"
    assert sum(method != "GET" for method, *_ in appliance.calls) == writes
    await controls.close()


async def test_ambiguous_mode_write_is_not_repeated_and_restart_restores_prior_mode():
    controls, _, appliance, store, _ = setup_settings()
    appliance.disconnect_after_write = True
    assert (await submit(controls, "native_mode", {"mode": 2, "profile_id": -1}))["phase"] == "uncertain"
    assert appliance.mode["currentMode"] == 2
    await controls.close()
    restarted, coordinator, _, _, _ = setup_settings(appliance=appliance, store=store)
    await restarted.reconcile()
    assert appliance.mode["currentMode"] == 1 and store.value["active"] is None
    assert store.value["history"][-1]["phase"] == "restored"
    assert coordinator.cloud_data["mode"] == "Sigen AI Mode"
    await restarted.close()


async def test_a_serial_list_without_an_explicit_charger_presence_flag_never_enables_control():
    controls, _, appliance, _, _ = setup_settings()
    old = appliance._data

    async def read(method, path, **kwargs):
        result = await old(method, path, **kwargs)
        if path == "device/owner/station/home":
            result["hasEv"] = False
        return result

    appliance._data = read
    result = await submit(controls, "dc_charging", True)
    assert result["phase"] == "failed"
    assert not any(method != "GET" for method, *_ in appliance.calls)
    await controls.close()


@pytest.mark.parametrize("key,serial", [("ac_charging", "AC-B"), ("dc_charging", None)])
async def test_charger_start_and_stop_target_only_the_discovered_selected_device(key, serial):
    controls, _, appliance, store, _ = setup_settings()
    assert (await submit(controls, key, True, serial=serial))["phase"] == "confirmed"
    selected = serial or "DC-A"
    assert appliance.chargers[selected] == 3 and appliance.chargers["AC-A"] == 4
    assert store.value["history"][-1]["provider_metadata"]["devices"][key] == selected
    assert (await submit(controls, key, False, request_id="stop", serial=serial))["phase"] == "confirmed"
    assert appliance.chargers[selected] == 4
    await controls.close()


@pytest.mark.parametrize("serial", [None, "foreign-charger"])
async def test_ambiguous_or_foreign_charger_identity_is_rejected(serial):
    controls, _, appliance, _, _ = setup_settings()
    assert (await submit(controls, "ac_charging", True, serial=serial))["phase"] == "failed"
    assert not any(method != "GET" for method, *_ in appliance.calls)
    await controls.close()


async def test_gateway_switch_uses_native_ack_and_state_confirmation():
    controls, _, appliance, store, _ = setup_settings()
    assert (await submit(controls, "grid_connection", False))["phase"] == "confirmed"
    assert appliance.gateway["onOffGridStatus"] == 2
    assert (await submit(controls, "grid_connection", True, request_id="reconnect"))["phase"] == "confirmed"
    assert appliance.gateway["onOffGridStatus"] == 0 and store.value["active"] is None
    await controls.close()


async def test_battery_soc_setting_respects_owner_limits_and_preserves_ja12():
    controls, _, appliance, _, _ = setup_settings()
    value = {"charge_soc": 90, "discharge_soc": 20, "backup_soc": 0, "peak_shaving_soc": None}
    assert (await submit(controls, "battery_levels", value))["phase"] == "confirmed"
    assert appliance.levels["ja12SOC"] == "0.0" and float(appliance.levels["chargeSOC"]) == 90
    writes = sum(method != "GET" for method, *_ in appliance.calls)
    assert (await submit(controls, "battery_levels", {**value, "discharge_soc": 1}, request_id="bad"))["phase"] == "failed"
    assert sum(method != "GET" for method, *_ in appliance.calls) == writes
    await controls.close()


def test_mode_catalogue_rejects_duplicate_identities_and_non_mode_values():
    with pytest.raises(SafetyError):
        mode_catalogue({"defaultWorkingModes": [{"value": True, "label": "Bad"}]})
    with pytest.raises(SafetyError):
        mode_catalogue({"defaultWorkingModes": [{"value": "0", "label": "a"}, {"value": "0", "label": "b"}]})
