"""Exercise entry isolation and reuse without importing Home Assistant runtime."""

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest


def setup_handler(*, loaded=True, domain="sigen_hybrid", connected=True, cloud_present=True):
    loaded_state = object()
    calls = {"connect": 0, "brokers": 0, "queries": 0}

    class Broker:
        def __init__(self, client, **kwargs):
            calls["brokers"] += 1
            assert kwargs == {"timezone": "Europe/Dublin", "currency": "EUR"}

        async def get(self, **kwargs):
            calls["queries"] += 1
            if calls.get("failure"):
                raise calls["failure"]
            return {"series": [{"soc": [[1, 75]]}], "source": "sigenergy_cloud"}

    cloud = SimpleNamespace(_lock=asyncio.Lock(), _connected=connected, client=object())

    async def connect():
        calls["connect"] += 1
        await asyncio.sleep(0)
        cloud._connected = True

    cloud.connect = connect
    entry = SimpleNamespace(
        entry_id="synthetic-entry",
        domain=domain,
        state=loaded_state if loaded else object(),
        runtime_data=SimpleNamespace(cloud=cloud if cloud_present else None),
        data={},
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_get_entry=lambda ident: entry),
        data={},
        config=SimpleNamespace(time_zone="Europe/Dublin", currency="EUR"),
    )
    results, errors = [], []
    connection = SimpleNamespace(
        send_result=lambda ident, result: results.append(result),
        send_error=lambda ident, code, message: errors.append((code, message)),
    )
    tree = ast.parse(Path("custom_components/sigen_hybrid/history_ws.py").read_text())
    node = next(
        item for item in tree.body if isinstance(item, ast.AsyncFunctionDef) and item.name == "websocket_history"
    )
    node.decorator_list = []
    scope = {
        "DOMAIN": "sigen_hybrid",
        "ConfigEntryState": SimpleNamespace(LOADED=loaded_state),
        "HistoryBroker": Broker,
    }
    exec(compile(ast.Module(body=[node], type_ignores=[]), "history_ws.py", "exec"), scope)
    message = {
        "id": 1,
        "config_entry": entry.entry_id,
        "kind": "soc",
        "period": "day",
        "date": "2026-10-27",
        "start_time": "2026-10-27T00:00:00+00:00",
        "end_time": "2026-10-28T00:00:00+00:00",
    }
    return scope["websocket_history"], hass, connection, message, calls, results, errors


@pytest.mark.parametrize("kwargs", [{"loaded": False}, {"domain": "unrelated"}])
async def test_history_rejects_unloaded_or_wrong_integration_entries(kwargs):
    handler, hass, connection, message, calls, results, errors = setup_handler(**kwargs)
    await handler(hass, connection, message)
    assert errors[0][0] == "invalid_entry" and not results and calls["connect"] == calls["queries"] == 0


async def test_history_reuses_authenticated_client_and_broker_without_refresh():
    handler, hass, connection, message, calls, results, errors = setup_handler()
    await handler(hass, connection, message)
    await handler(hass, connection, message)
    assert calls == {"connect": 0, "brokers": 1, "queries": 2}
    assert len(results) == 2 and not errors


async def test_disconnected_history_never_starts_or_repeats_login_for_parallel_charts():
    handler, hass, connection, message, calls, results, errors = setup_handler(connected=False)

    async def failed_login():
        calls["connect"] += 1
        raise RuntimeError("PRIVATE AUTH FAILURE")

    hass.config_entries.async_get_entry(message["config_entry"]).runtime_data.cloud.connect = failed_login
    await asyncio.gather(*(handler(hass, connection, message) for _ in range(20)))
    assert calls["connect"] == calls["brokers"] == calls["queries"] == 0
    assert len(results) == 20 and not errors
    assert all(result == {"series": [], "source": "cloud_unavailable", "available": False} for result in results)


async def test_history_cloud_absence_and_failures_leave_local_fallback_without_private_text():
    handler, hass, connection, message, calls, results, errors = setup_handler(cloud_present=False)
    await handler(hass, connection, message)
    assert calls["queries"] == 0 and results[-1]["series"] == []
    handler, hass, connection, message, calls, results, errors = setup_handler()
    calls["failure"] = RuntimeError("PRIVATE ACCOUNT RESPONSE")
    await handler(hass, connection, message)
    assert results[-1] == {"series": [], "source": "cloud_unavailable", "available": False}
    assert "PRIVATE" not in str(results) + str(errors)
    calls["failure"] = ValueError("PRIVATE RANGE INPUT")
    await handler(hass, connection, message)
    assert errors[-1][0] == "invalid_history_request" and "PRIVATE" not in str(errors)


def test_history_registration_is_idempotent_across_entry_reload():
    tree = ast.parse(Path("custom_components/sigen_hybrid/history_ws.py").read_text())
    node = next(
        item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "async_register_history"
    )
    registered = []
    scope = {
        "DOMAIN": "sigen_hybrid",
        "websocket_history": object(),
        "websocket_energy_baselines": object(),
        "websocket_api": SimpleNamespace(async_register_command=lambda hass, command: registered.append(command)),
    }
    exec(compile(ast.Module(body=[node], type_ignores=[]), "history_ws.py", "exec"), scope)
    hass = SimpleNamespace(data={})
    scope["async_register_history"](hass)
    scope["async_register_history"](hass)
    assert len(registered) == 2
