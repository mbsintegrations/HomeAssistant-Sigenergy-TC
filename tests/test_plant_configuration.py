"""Native presets retain their origin and never become executable TC rules."""

from copy import deepcopy

import pytest

from custom_components.sigen_hybrid.core.errors import CapabilityError, SafetyError
from custom_components.sigen_hybrid.core.plant_configuration import PlantConfiguration, safe_document


class Client:
    station_id = "42"

    def __init__(self):
        self.calls = []
        self.values = {
            "device/energy-profile/mode/current/42": {"currentMode": 0, "currentProfileId": -1},
            "aipv-biz/api/v1/sigenai/personalization/rules": {"personalizationRulesList": [
                {"personalizationRuleId": 17, "personalizationRuleName": "Low battery", "ruleStatus": 1,
                 "ruleCondition": "Every day 02:00-05:00, SOC <= 40%", "ruleEffect": "Force charge"}]},
            "device/energy-profile/mode/all/42": {"energyProfileItems": [{"profileId": 7, "name": "Winter"}]},
            "device/energy-profile/setting/info/42": {"profileId": 7, "name": "Winter"},
            "device/acevse/schedule/list/42": [],
            "device/aio/network/read": {"networkType": "Ethernet", "password": "do-not-return"},
        }

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, deepcopy(kwargs)))
        return deepcopy(self.values[path])


async def test_native_personal_rules_use_the_observed_query_not_operating_profiles():
    client = Client()
    reader = PlantConfiguration(client, "42")
    result = await reader.read("strategies")
    assert result["value"]["rules"][0]["personalizationRuleId"] == 17
    assert result["read_only"] and result["source"] == "cloud"
    assert client.calls == [
        ("GET", "device/energy-profile/mode/current/42", {}),
        ("POST", "aipv-biz/api/v1/sigenai/personalization/rules", {"json": {"stationId": 42, "workingMode": 0}}),
    ]
    result["value"]["rules"].clear()
    assert (await reader.read("strategies"))["value"]["rules"]
    assert len(client.calls) == 2  # Read cache, no duplicate login/query.


async def test_configuration_is_plant_bound_and_never_accepts_a_foreign_profile():
    client = Client()
    reader = PlantConfiguration(client, "42")
    with pytest.raises(SafetyError):
        await reader.read("profile", profile_id=8)
    assert not any("setting/info" in path for _, path, _ in client.calls)
    client.station_id = "43"
    with pytest.raises(SafetyError):
        await reader.read("profiles")  # Identity checked before cached response.


async def test_charger_schedules_are_zero_preserving_device_scoped_and_read_only():
    client = Client()
    inventory = [{"id": "AC-TEST", "serial": "AC-TEST", "type": "ac", "installed": True}]
    reader = PlantConfiguration(client, "42", inventory=lambda: inventory)
    result = await reader.read("charger_schedules", serial="AC-TEST")
    assert result["value"] == []
    assert client.calls == [("GET", "device/acevse/schedule/list/42", {"params": {"snCode": "AC-TEST"}})]
    with pytest.raises(CapabilityError):
        await reader.read("charger_schedules", serial="OTHER-PLANT")
    inventory.clear()
    with pytest.raises(CapabilityError):
        await reader.read("charger_schedules", serial="AC-TEST")


async def test_provider_failures_do_not_become_empty_lists_or_trigger_repeated_requests():
    client = Client()
    del client.values["aipv-biz/api/v1/sigenai/personalization/rules"]
    reader = PlantConfiguration(client, "42")
    with pytest.raises(KeyError):
        await reader.read("strategies")
    with pytest.raises(CapabilityError):
        await reader.read("strategies")
    assert len(client.calls) == 2


async def test_network_read_removes_credentials_without_losing_real_zero_and_false():
    client = Client()
    reader = PlantConfiguration(client, "42", inventory=lambda: [{"id": "EC-TEST", "type": "inverter"}])
    result = await reader.read("network", serial="EC-TEST")
    assert result["value"] == {"networkType": "Ethernet"}
    assert safe_document({"zero": 0, "disabled": False, "nested": {"accessToken": "secret", "state": None}}) == {
        "zero": 0, "disabled": False, "nested": {"state": None}}
    with pytest.raises(SafetyError):
        safe_document(float("nan"))


async def test_native_configuration_uses_the_existing_client_without_a_refresh_burst_lock():
    """Loaded read-only entries need no control permission or browser session."""
    import ast
    import asyncio
    from pathlib import Path
    from types import SimpleNamespace

    client = Client()
    loaded = object()
    class BusyRefresh:
        async def __aenter__(self):
            raise AssertionError("A settings read must not wait for the full refresh burst")
    runtime = SimpleNamespace(cloud=SimpleNamespace(_connected=True, station_id="42", client=client),
                              cloud_data={"device_inventory": []}, _cloud_update_lock=BusyRefresh())
    entry = SimpleNamespace(domain="sigen_hybrid", state=loaded, runtime_data=runtime, options={"cloud": {"station_id": "42"}, "control": {"enabled": False}})
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda key: entry if key == "own" else None))
    results, errors = [], []
    connection = SimpleNamespace(send_result=lambda _, result: results.append(result), send_error=lambda _, code, message: errors.append(code))
    tree = ast.parse(Path("custom_components/sigen_hybrid/owner_configuration.py").read_text())
    node = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "websocket_plant_configuration")
    node.decorator_list = []
    scope = {"asyncio": asyncio, "DOMAIN": "sigen_hybrid", "ConfigEntryState": SimpleNamespace(LOADED=loaded), "PlantConfiguration": PlantConfiguration}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "owner_configuration.py", "exec"), scope)
    command = scope["websocket_plant_configuration"]
    await command(hass, connection, {"id": 1, "config_entry": "own", "section": "strategies"})
    assert not errors and results[0]["value"]["rules"][0]["personalizationRuleId"] == 17
    assert len(client.calls) == 2
    await command(hass, connection, {"id": 2, "config_entry": "foreign", "section": "strategies"})
    assert errors == ["invalid_entry"] and len(client.calls) == 2


async def test_indicator_channels_and_station_settings_are_fixed_read_operations():
    client = Client()
    client.values.update({"device/station/light-board/light/info": {"enable": False, "brightness": 0},
                          "device/owner/station/save-energy-mode/42": {"mode": 0}})
    reader = PlantConfiguration(client, "42")
    result = await reader.read("indicators")
    assert result["value"] == {"front": {"enable": False, "brightness": 0}, "strips": {"enable": False, "brightness": 0}}
    assert [call[2]["params"]["type"] for call in client.calls] == [0, 1]
    assert (await reader.read("energy_saving"))["value"]["mode"] == 0
    assert all(call[0] == "GET" for call in client.calls)


async def test_identity_drift_during_a_query_does_not_populate_the_cache():
    client = Client()
    original = client._data
    async def drift(*args, **kwargs):
        value = await original(*args, **kwargs)
        client.station_id = "43"
        return value
    client._data = drift
    reader = PlantConfiguration(client, "42")
    with pytest.raises(SafetyError):
        await reader.read("strategies")
    assert not reader.cache and len(client.calls) == 1


async def test_scalar_cloud_read_also_avoids_the_full_refresh_lock_without_write_permission():
    import ast
    import asyncio
    from pathlib import Path
    from types import SimpleNamespace

    from custom_components.sigen_hybrid.core.control_providers import CloudControlSettings
    from custom_components.sigen_hybrid.core.errors import SigenError
    from custom_components.sigen_hybrid.core.native_settings import charger_key

    client = Client()
    client.values["device/energy-profile/battery/level/42"] = {"chargeSOC": 100, "dischargeSOC": 0, "backupSOC": 0, "peakShavingSOC": ""}
    loaded = object()
    class BusyRefresh:
        async def __aenter__(self):
            raise AssertionError("Read-only owner configuration must not acquire the background-refresh lock")
    runtime = SimpleNamespace(cloud=SimpleNamespace(_connected=True, station_id="42", client=client), local=None,
                              controls=SimpleNamespace(local=None), _cloud_update_lock=BusyRefresh())
    entry = SimpleNamespace(domain="sigen_hybrid", state=loaded, runtime_data=runtime, options={"cloud": {"station_id": "42"}})
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda _: entry))
    results, errors = [], []
    connection = SimpleNamespace(send_result=lambda _, result: results.append(result), send_error=lambda _, code, message: errors.append(code))
    tree = ast.parse(Path("custom_components/sigen_hybrid/owner_configuration.py").read_text())
    node = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "websocket_owner_configuration")
    node.decorator_list = []
    scope = {"__name__": "custom_components.sigen_hybrid.owner_configuration", "asyncio": asyncio, "DOMAIN": "sigen_hybrid",
             "ConfigEntryState": SimpleNamespace(LOADED=loaded), "CloudControlSettings": CloudControlSettings,
             "SigenError": SigenError, "charger_key": charger_key, "setting_revision": lambda value: "revision"}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "owner_configuration.py", "exec"), scope)
    await scope["websocket_owner_configuration"](hass, connection, {"id": 1, "config_entry": "own", "setting": "battery_levels"})
    assert not errors and results[0]["value"]["discharge_soc"] == 0
    assert [method for method, _, _ in client.calls] == ["GET"]
