"""Known owner API payloads and Modbus settings remain bound and allowlisted."""

import copy
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.control_providers import CloudControlSettings, ModbusControlSettings
from custom_components.sigen_hybrid.core.errors import SafetyError, TransportError
from custom_components.sigen_hybrid.core.recovery import RecoveryJournal

NOW = datetime(2026, 10, 29, 19, tzinfo=timezone.utc)


class Cloud:
    station_id = "42"

    def __init__(self):
        self.calls = []
        self.error = None
        self.mode = {"currentMode": 1, "currentProfileId": -1}
        self.manual = {"enable": False}
        self.export = {"currentEnable": False, "ownerSetEnable": None, "installerSetEnable": None}
        self.levels = {"chargeSOC": 100, "dischargeSOC": 5, "peakShavingSOC": 10, "backupSOC": 20}

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if "/mode/current/" in path:
            return copy.deepcopy(self.mode)
        if "/instant/manunal/" in path:
            return copy.deepcopy(self.manual)
        if "/export/limitation/" in path:
            return copy.deepcopy(self.export)
        if "/battery/level/" in path:
            return copy.deepcopy(self.levels)
        raise AssertionError(path)

    async def _envelope(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.error:
            raise self.error
        return {"code": 0}


def provider(client=None):
    return CloudControlSettings(client or Cloud(), "42", native_modes={1, 2, 9}, profiles={7}, clock=lambda: NOW)


async def test_cloud_mode_payload_has_immutable_station_even_if_sdk_default_changes():
    cloud = Cloud()
    settings = provider(cloud)
    cloud.station_id = "999"
    await settings.write("native_mode", {"mode": 2, "profile_id": -1})
    assert cloud.calls == [
        ("PUT", "device/energy-profile/mode", {"json": {"stationId": 42, "operationMode": 2, "profileId": -1}})
    ]
    assert await settings.identity() == "cloud:999"  # Journal identity guard rejects this drift.


async def test_readback_is_fresh_and_does_not_use_mutable_station_formatting():
    cloud = Cloud()
    settings = provider(cloud)
    assert (await settings.read(["native_mode"]))["native_mode"] == {"mode": 1, "profile_id": -1}
    cloud.mode["currentMode"] = 2
    assert (await settings.read(["native_mode"]))["native_mode"]["mode"] == 2
    assert all(call[1].endswith("/42") for call in cloud.calls)


async def test_disabled_unset_grid_limit_is_not_coerced_to_a_zero_export_limit():
    cloud = Cloud()
    original = cloud._data
    async def read(method, path, **kwargs):
        if "/grid/limitation/" in path:
            return {"enable": False, "maxLimitationOwner": "", "maxLimitation": "", "maxLimitationInstaller": "5"}
        return await original(method, path, **kwargs)
    cloud._data = read
    settings = provider(cloud)
    before = (await settings.read(["grid_export_limit"]))["grid_export_limit"]
    assert before == {"enabled": False, "limit_kw": None}
    assert settings.matches("grid_export_limit", before, before)
    assert not settings.matches("grid_export_limit", before, {"enabled": False, "limit_kw": 0})
    with pytest.raises(SafetyError):
        settings.validate("grid_export_limit", {"enabled": True, "limit_kw": None})
    await settings.write("grid_export_limit", before)
    assert cloud.calls[-1][2]["json"] == {"stationId": 42, "enable": False, "maxLimitationOwner": "", "maxLimitationInstaller": None}


async def test_existing_dc_v2x_mode_can_be_read_without_enabling_vehicle_dispatch():
    cloud = Cloud()
    async def read(method, path, **kwargs):
        assert method == "GET" and path == "device/charge/mode/dc"
        return {"chargeMode": 2, "enableFromPack": True, "cutoffSocFromPack": 20,
                "allowsDischargePower": 25, "vehicleDischargeCutoffSoc": 20,
                "minimumDischargeCutoffSoc": 20, "maximumDischargeCutoffSoc": 99}
    cloud._data = read
    settings = provider(cloud)
    settings.devices["dc_charging"] = "DC-TEST"
    value = (await settings.read(["dc_charge_mode"]))["dc_charge_mode"]
    assert value["mode"] == 2 and value["battery_boost"] is True
    assert value["discharge_power_kw"] == 25
    with pytest.raises(SafetyError):
        await settings.write("dc_charge_mode", value)
    assert cloud.calls == []


@pytest.mark.parametrize("duration", [1, 30, 180, 1440])
async def test_manual_duration_payload_supports_whole_minutes_without_sdk_unlimited_power(duration):
    cloud = Cloud()
    settings = provider(cloud)
    desired = {
        "enabled": True,
        "mode": "0",
        "duration_minutes": duration,
        "power_kw": 1.25,
        "expected_end_time": NOW.timestamp() + duration * 60,
    }
    await settings.write("manual", desired)
    payload = cloud.calls[-1][2]["json"]
    assert payload == {
        "stationId": 42,
        "enable": True,
        "mode": "0",
        "duration": str(duration),
        "powerLimitation": "1.250",
    }


async def test_manual_stop_returns_control_without_sending_a_new_duration_or_power():
    cloud = Cloud()
    await provider(cloud).write("manual", {"enabled": False})
    assert cloud.calls[-1][2]["json"] == {
        "stationId": 42,
        "enable": False,
        "mode": "",
        "duration": "",
        "powerLimitation": "",
    }


async def test_cloud_failure_is_credential_free_and_never_retried():
    cloud = Cloud()
    cloud.error = RuntimeError("private-account-and-provider-response")
    with pytest.raises(TransportError) as exc:
        await provider(cloud).write("manual", {"enabled": False})
    assert "private-account" not in str(exc.value)
    assert len(cloud.calls) == 1


async def test_battery_export_block_preserves_installer_setting_and_uses_the_native_direction():
    cloud = Cloud()
    await provider(cloud).write("battery_export_block", True)
    assert cloud.calls[-1][2]["json"] == {"stationId": 42, "installerSetEnable": None, "ownerSetEnable": True}


async def test_native_effective_export_block_is_read_even_when_owner_flag_is_unset():
    cloud = Cloud()
    settings = provider(cloud)
    assert await settings.read(["battery_export_block"]) == {"battery_export_block": False}
    assert settings.recovery_metadata()["battery_export_block"]["ownerSetEnable"] is None
    cloud.export = {"currentEnable": True, "ownerSetEnable": False, "installerSetEnable": True}
    assert await settings.read(["battery_export_block"]) == {"battery_export_block": True}


async def test_clearing_an_installer_export_block_is_rejected_without_a_write():
    cloud = Cloud()
    cloud.export = {"currentEnable": True, "ownerSetEnable": None, "installerSetEnable": True}
    with pytest.raises(SafetyError, match="installer"):
        await provider(cloud).write("battery_export_block", False)
    assert [call[0] for call in cloud.calls] == ["GET"]


async def test_missing_effective_export_state_is_not_inferred_from_owner_default():
    cloud = Cloud()
    cloud.export = {"currentEnable": None, "ownerSetEnable": False, "installerSetEnable": None}
    with pytest.raises(SafetyError):
        await provider(cloud).read(["battery_export_block"])


class MemoryStore:
    value = None

    async def async_load(self):
        return copy.deepcopy(self.value)

    async def async_save(self, value):
        self.value = copy.deepcopy(value)


async def test_installer_restriction_stops_the_whole_transaction_before_an_unrelated_mode_write():
    cloud = Cloud()
    cloud.export.update(currentEnable=True, installerSetEnable=True)
    store = MemoryStore()
    journal = RecoveryJournal(store, provider(cloud), plant_identity="cloud:42", clock=lambda: NOW)
    with pytest.raises(SafetyError, match="installer"):
        await journal.apply(
            "guarded", [("native_mode", {"mode": 2, "profile_id": -1}), ("battery_export_block", False)]
        )
    assert store.value is None
    assert all(call[0] == "GET" for call in cloud.calls)


async def test_original_unset_owner_flag_is_recorded_and_effective_export_block_restores():
    class Plant(Cloud):
        async def _envelope(self, method, path, **kwargs):
            result = await super()._envelope(method, path, **kwargs)
            self.export.update(
                currentEnable=kwargs["json"]["ownerSetEnable"], ownerSetEnable=kwargs["json"]["ownerSetEnable"]
            )
            return result

    cloud, store = Plant(), MemoryStore()
    journal = RecoveryJournal(store, provider(cloud), plant_identity="cloud:42", clock=lambda: NOW)
    await journal.apply("home", [("battery_export_block", True)], expires_at=NOW + timedelta(minutes=30))
    assert cloud.export["currentEnable"] is True
    assert store.value["active"]["provider_metadata"]["battery_export_block"]["ownerSetEnable"] is None
    assert (await journal.restore())["phase"] == "restored"
    assert cloud.export == {"currentEnable": False, "ownerSetEnable": False, "installerSetEnable": None}


async def test_unknown_installer_restriction_metadata_cannot_be_used_to_unblock_export():
    cloud = Cloud()
    del cloud.export["installerSetEnable"]
    with pytest.raises(SafetyError, match="incomplete"):
        await provider(cloud).write("battery_export_block", False)
    assert all(call[0] == "GET" for call in cloud.calls)


async def test_all_soc_values_are_preserved_in_the_reversible_payload():
    cloud = Cloud()
    settings = provider(cloud)
    before = (await settings.read(["battery_levels"]))["battery_levels"]
    await settings.write("battery_levels", {**before, "backup_soc": 25})
    assert cloud.calls[-1][2]["json"] == {
        "stationId": 42,
        "chargeSOC": "100",
        "dischargeSOC": "5",
        "peakShavingSOC": "10",
        "backupSOC": "25",
    }


async def test_actual_native_soc_strings_and_empty_optional_field_are_preserved():
    cloud = Cloud()
    cloud.levels = {
        "chargeSOC": "100.0",
        "dischargeSOC": "0.0",
        "backupSOC": "0.0",
        "peakShavingSOC": "",
        "ja12SOC": "0.0",
    }
    settings = provider(cloud)
    before = (await settings.read(["battery_levels"]))["battery_levels"]
    assert before == {
        "charge_soc": 100,
        "discharge_soc": 0,
        "backup_soc": 0,
        "peak_shaving_soc": None,
        "ja12_soc": "0.0",
    }
    await settings.write("battery_levels", {**before, "backup_soc": 15})
    assert cloud.calls[-1][2]["json"] == {
        "stationId": 42,
        "chargeSOC": "100",
        "dischargeSOC": "0",
        "backupSOC": "15",
        "peakShavingSOC": None,
    }
    assert settings.recovery_metadata()["battery_levels"]["peakShavingSOC"] == ""


async def test_fractional_soc_is_not_silently_truncated_and_additional_soc_cannot_be_changed():
    cloud = Cloud()
    cloud.levels["dischargeSOC"] = "5.5"
    cloud.levels["ja12SOC"] = "0.0"
    settings = provider(cloud)
    before = (await settings.read(["battery_levels"]))["battery_levels"]
    assert before["discharge_soc"] == 5.5
    with pytest.raises(SafetyError, match="additional"):
        await settings.write("battery_levels", {**before, "ja12_soc": "2.0"})
    assert all(call[0] == "GET" for call in cloud.calls)


@pytest.mark.parametrize(
    "key,value",
    [
        ("arbitrary_endpoint", True),
        ("battery_export_block", "false"),
        ("battery_export", False),
        ("native_mode", {"mode": 8, "profile_id": -1}),
        ("native_mode", {"mode": 9, "profile_id": 99}),
        ("native_mode", {"mode": True, "profile_id": -1}),
        ("manual", {"enabled": False, "mode": "0"}),
        ("battery_levels", {"charge_soc": 0}),
    ],
)
async def test_unknown_or_unsupported_cloud_changes_never_leave_the_process(key, value):
    cloud = Cloud()
    with pytest.raises(SafetyError):
        await provider(cloud).write(key, value)
    assert cloud.calls == []


def test_manual_readback_requires_the_same_mode_and_bounded_expiry_and_checks_power_when_exposed():
    desired = {"enabled": True, "mode": "0", "power_kw": 1, "expected_end_time": NOW.timestamp() + 1800}
    observed = {"enabled": True, "mode": "0", "end_time": NOW.timestamp() + 1810, "power_kw": 1}
    assert CloudControlSettings.matches("manual", desired, observed)
    assert not CloudControlSettings.matches("manual", desired, {**observed, "mode": "1"})
    assert not CloudControlSettings.matches("manual", desired, {**observed, "end_time": NOW.timestamp() + 8000})
    assert not CloudControlSettings.matches("manual", desired, {**observed, "power_kw": 4})


class Local:
    def __init__(self):
        self.values = {"remote_ems": 0, "remote_mode": 2, "charge_limit_kw": 4_294_967.295, "discharge_limit_kw": 3}
        self.writes = []

    async def read(self, key):
        return self.values[key]

    async def write_confirmed(self, key, value):
        self.writes.append((key, value))
        self.values[key] = value


async def test_local_power_setpoints_are_bounded_but_the_original_unlimited_marker_can_be_restored():
    local = Local()

    async def identity():
        return "local-inverter-serial"

    settings = ModbusControlSettings(local, identity, max_charge_kw=5, max_discharge_kw=5)
    original = (await settings.read(["charge_limit_kw"]))["charge_limit_kw"]
    with pytest.raises(SafetyError, match="limit"):
        await settings.write("charge_limit_kw", original)
    await settings.write("charge_limit_kw", 2)
    await settings.restore("charge_limit_kw", original)
    assert local.writes == [("charge_limit_kw", 2), ("charge_limit_kw", 4_294_967.295)]
    with pytest.raises(SafetyError, match="allowlist"):
        await settings.write("backup_soc", 0)
