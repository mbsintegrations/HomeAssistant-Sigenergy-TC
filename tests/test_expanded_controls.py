"""Owner writes, serialization, recovery and conflict tests with fake appliances."""

import copy
import hashlib
from dataclasses import replace
from datetime import timedelta

import pytest
from test_control_session import NOW, Store, setup

from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.control_providers import CloudControlSettings
from custom_components.sigen_hybrid.core.errors import SafetyError, TransportError
from custom_components.sigen_hybrid.core.local_control import LocalControlSession, LocalControlSettings
from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits
from custom_components.sigen_hybrid.core.native_settings import PATHS, UNLIMITED
from custom_components.sigen_hybrid.core.owner_settings import prepare_setting
from custom_components.sigen_hybrid.core.recovery import RecoveryJournal, canonical


class NativeAppliance:
    station_id = "42"

    def __init__(self, key, data):
        self.key, self.data, self.writes = key, copy.deepcopy(data), []

    async def _data(self, method, path, **kwargs):
        assert method == "GET" and path == PATHS[self.key]+"/42"
        return copy.deepcopy(self.data)

    async def _envelope(self, method, path, **kwargs):
        assert path == PATHS[self.key]
        data = copy.deepcopy(kwargs["json"])
        assert data.pop("stationId") == 42
        self.writes.append((method, path, data))
        if self.key == "grid_connection_current":
            assert data["installerSetLimitation"] is None
            self.data.update(enable=data["enable"], ownerSetLimitation=data["ownerSetLimitation"])
        elif self.key == "solar_priority":
            rows = data["loadsPvPriorityList"]
            assert all(set(row) == {"loadsType", "sgDeviceType", "smartLoadsPath", "priority"} for row in rows)
            for row in rows:
                next(item for item in self.data if item["loadsType"] == row["loadsType"])["priority"] = row["priority"]
        else:
            self.data.update(data)
        return {"success": True}


CASES = [
    ("battery_power_limits", {"batteryMaxChargingPower": "5.000", "batteryMaxDischargingPower": "5.000"}, {"charge_kw": 2, "discharge_kw": 3}),
    ("pv_power_limit", {"powerLimit": "4294967.295"}, {"limit_kw": 4}),
    ("backup_reserve", {"backupReserve": 20}, {"soc": 30}),
    ("grid_connection_current", {"enable": True, "currentLimitation": "32", "ownerSetLimitation": "32", "installerSetLimitation": "40"}, {"enabled": True, "limit_a": 24}),
    ("discharge_priority", {"priority": ["HOME", "EVDC", "GRID"]}, {"order": ["EVDC", "HOME", "GRID"]}),
    ("peak_shaving", {"controlMode": 0, "shavingSOC": 20, "settingList": []}, {"enabled": True, "soc": 30, "slots": [{"weekdays": [1, 7], "start": "17:00", "end": "19:00", "power_kw": 2}]}),
    ("solar_priority", [{"loadKey": "battery", "loadsType": 1, "sgDeviceType": None, "smartLoadsPath": None, "priority": 0},
                        {"loadKey": "ev", "loadsType": 2, "sgDeviceType": None, "smartLoadsPath": None, "priority": 1}], {"order": ["ev", "battery"]}),
]


@pytest.mark.parametrize("key,data,desired", CASES)
async def test_native_owner_write_readback_and_durable_recovery(key, data, desired):
    appliance = NativeAppliance(key, data)
    provider = CloudControlSettings(appliance, "42", region="eu")
    journal = RecoveryJournal(Store(), provider, plant_identity="cloud:eu:42", clock=lambda: NOW)
    before = (await provider.read([key]))[key]
    result = await journal.apply("native", [(key, desired)], expires_at=NOW+timedelta(minutes=1))
    assert result["phase"] == "confirmed" and len(appliance.writes) == 1
    assert provider.matches(key, desired, (await provider.read([key]))[key])
    assert (await journal.restore())["phase"] == "restored"
    assert provider.matches(key, before, (await provider.read([key]))[key])


async def test_installer_current_limit_and_unknown_destinations_cannot_be_overwritten():
    appliance = NativeAppliance("grid_connection_current", CASES[3][1])
    provider = CloudControlSettings(appliance, "42")
    baseline = await provider.read(["grid_connection_current"])
    with pytest.raises(SafetyError, match="installer"):
        provider.preflight([("grid_connection_current", {"enabled": True, "limit_a": 63})], baseline)
    assert appliance.writes == []
    appliance = NativeAppliance("discharge_priority", CASES[4][1])
    provider = CloudControlSettings(appliance, "42")
    baseline = await provider.read(["discharge_priority"])
    with pytest.raises(SafetyError, match="existing"):
        provider.preflight([("discharge_priority", {"order": ["OTHER"]})], baseline)


@pytest.mark.parametrize("key,value", [
    ("battery_export_block", False), ("grid_export_limit", {"enabled": False, "limit_kw": 0}),
    ("grid_export_limit", {"enabled": True, "limit_kw": 1}),
    ("battery_power_limits", {"charge_kw": 4, "discharge_kw": 3}),
    ("backup_reserve", {"soc": 10}),
])
async def test_global_owner_and_export_bounds_apply_to_extended_controls(key, value):
    provider = CloudControlSettings(NativeAppliance("backup_reserve", {}), "42")
    with pytest.raises(SafetyError):
        await prepare_setting(provider, key, value, owner_limits=SafetyLimits(), station={})


class LocalAppliance:
    read_only = False

    def __init__(self):
        self.values = {"remote_ems": 0, "remote_mode": 2, "charge_limit_kw": 5, "discharge_limit_kw": 5,
                       "backup_soc": 10, "charge_cutoff_soc": 95, "discharge_cutoff_soc": 10,
                       "grid_sensor_connected": 1, "grid_export_limit_kw": 0, "grid_import_limit_kw": 10,
                       "pv_limit_kw": UNLIMITED, "grid_state": 0, "running_state": 1, "soc": 50}
        self.writes, self.fail, self.serial = [], None, "INVERTER-42"

    async def read(self, key):
        return self.values[key]

    async def write_confirmed(self, key, value):
        self.writes.append((key, value))
        self.values[key] = value
        if self.fail == key:
            self.fail = None
            raise TransportError("Synthetic accepted write with lost reply")


def local_setup(store=None, appliance=None, clock=None):
    clock = clock or [NOW]
    appliance = appliance or LocalAppliance()

    async def identity():
        if appliance.serial != "INVERTER-42":
            raise SafetyError("Physical identity changed")
        return "modbus:synthetic:INVERTER-42"

    provider = LocalControlSettings(appliance, identity, max_charge_kw=5, max_discharge_kw=5, clock=lambda: clock[0])
    journal = RecoveryJournal(store or Store(), provider, plant_identity="modbus:synthetic:INVERTER-42", clock=lambda: clock[0])
    session = LocalControlSession(journal, clock=lambda: clock[0])
    controller = Controller(SafetyLimits(), executor=session)
    snapshot = setup()[-1]
    return clock, appliance, journal, session, controller, snapshot


@pytest.mark.parametrize("mode,power,expected", [(Mode.CHARGE, 2, 4), (Mode.DISCHARGE, 2, 5), (Mode.HOLD, None, 2), (Mode.SELF_CONSUMPTION, None, 2)])
async def test_local_manual_modes_native_soc_and_restoration(mode, power, expected):
    clock, appliance, journal, session, controller, snapshot = local_setup()
    before = dict(appliance.values)
    result = await controller.execute(Intent(mode, power_kw=power), snapshot, NOW, dry_run=False)
    assert result.route == "modbus" and result.status == "confirmed"
    assert appliance.values["remote_mode"] == expected and appliance.values["remote_ems"] == 1
    assert appliance.values["charge_cutoff_soc"] == 90 and appliance.values["discharge_cutoff_soc"] == 20
    assert appliance.values["grid_export_limit_kw"] == 0
    assert appliance.writes[-1] == ("remote_ems", 1)
    assert (await session.release())["phase"] == "restored"
    assert appliance.values == before
    if mode == Mode.HOLD:
        assert ("charge_limit_kw", 0) in appliance.writes and ("discharge_limit_kw", 0) in appliance.writes


async def test_local_restart_expiry_and_lost_reply_do_not_replay_control():
    clock, appliance, journal, session, controller, snapshot = local_setup()
    appliance.fail = "remote_ems"
    with pytest.raises(TransportError):
        await controller.execute(Intent(Mode.CHARGE, power_kw=2, duration_minutes=1, request_id="lost"), snapshot, NOW, dry_run=False)
    assert len([value for key, value in appliance.writes if key == "remote_ems" and value == 1]) == 1
    restored = local_setup(journal.store, appliance, clock)
    assert (await restored[3].reconcile())["phase"] == "restored"
    assert appliance.values["remote_ems"] == 0
    assert len([value for key, value in appliance.writes if key == "remote_ems" and value == 1]) == 1
    snapshot = replace(snapshot, observed_at=clock[0])
    await restored[4].execute(Intent(Mode.HOLD, duration_minutes=1, request_id="timer"), snapshot, clock[0], dry_run=False)
    clock[0] += timedelta(minutes=2)
    restarted = local_setup(journal.store, appliance, clock)
    assert (await restarted[3].reconcile())["phase"] == "restored"
    assert appliance.values["remote_ems"] == 0


@pytest.mark.parametrize("problem", ["other_writer", "missing_sensor", "changed_identity"])
async def test_local_ownership_sensor_and_physical_identity_fail_before_any_write(problem):
    clock, appliance, journal, session, controller, snapshot = local_setup()
    if problem == "other_writer":
        appliance.values["remote_ems"] = 1
    elif problem == "missing_sensor":
        appliance.values["grid_sensor_connected"] = 0
    else:
        appliance.serial = "REPLACEMENT"
    with pytest.raises(SafetyError):
        await controller.execute(Intent(Mode.DISCHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    assert appliance.writes == []


async def test_local_grid_cap_can_be_tightened_but_not_raised_and_owner_changes_survive_release():
    clock, appliance, journal, session, controller, snapshot = local_setup()
    provider = journal.provider
    with pytest.raises(SafetyError, match="increasing"):
        await provider.setting_changes("grid_export_limit", {"enabled": True, "limit_kw": 1})
    assert await provider.setting_changes("grid_import_limit", {"enabled": True, "limit_kw": 5}) == [("grid_import_limit_kw", 5)]
    await controller.execute(Intent(Mode.CHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    appliance.values["charge_limit_kw"] = 1
    record = await session.release()
    assert record["phase"] == "superseded" and appliance.values["charge_limit_kw"] == 1
    assert appliance.values["remote_ems"] == 0


@pytest.mark.parametrize("kind,mode", [("ac", 2), ("dc", 3)])
async def test_native_charger_mode_uses_exact_serial_and_preserves_vehicle_discharge_fields(kind, mode):
    class Charger(NativeAppliance):
        async def _data(self, method, path, **kwargs):
            assert path == PATHS[self.key] and kwargs["params"] == {"stationId": 42, "snCode": "CHARGER-42"}
            return copy.deepcopy(self.data)

        async def _envelope(self, method, path, **kwargs):
            assert method == "POST" and kwargs["json"]["snCode"] == "CHARGER-42"
            self.writes.append(kwargs["json"])
            self.data.update({key: value for key, value in kwargs["json"].items() if key not in ("stationId", "snCode")})

    key = kind+"_charge_mode"
    appliance = Charger(key, {"chargeMode": 0, "enableFromPack": False, "cutoffSocFromPack": 50,
                              "enableFromGrid": False, "maxPowerFromGrid": 3,
                              "allowsDischargePower": 10, "vehicleDischargeCutoffSoc": 30})
    provider = CloudControlSettings(appliance, "42", **{kind+"_serial": "CHARGER-42"})
    before = (await provider.read([key]))[key]
    desired = {**before, "mode": mode, "battery_boost": True}
    await provider.write_checked(key, desired, before)
    assert provider.matches(key, desired, (await provider.read([key]))[key])
    assert appliance.writes[0]["allowsDischargePower"] == 10 and appliance.writes[0]["vehicleDischargeCutoffSoc"] == 30
    with pytest.raises(SafetyError, match="V2X"):
        await provider.write_checked(key, {**desired, "discharge_power_kw": 9}, desired)


async def test_stale_native_revision_does_not_overwrite_a_new_owner_value():
    appliance = NativeAppliance("backup_reserve", {"backupReserve": 20})
    provider = CloudControlSettings(appliance, "42", region="eu")
    before = (await provider.read(["backup_reserve"]))["backup_reserve"]
    revision = hashlib.sha256(canonical(before).encode()).hexdigest()
    appliance.data["backupReserve"] = 25
    journal = RecoveryJournal(Store(), provider, plant_identity="cloud:eu:42", clock=lambda: NOW)
    with pytest.raises(SafetyError, match="changed"):
        await journal.apply("stale", [("backup_reserve", {"soc": 30})],
                            context={"key": "backup_reserve", "expected_revision": revision})
    assert appliance.data["backupReserve"] == 25 and appliance.writes == []


async def test_stale_local_revision_fails_at_final_snapshot_before_any_write():
    from custom_components.sigen_hybrid.local_controls import setting_revision

    clock, appliance, journal, session, controller, snapshot = local_setup()
    identity = await journal.provider.identity()
    before = (await journal.provider.read(["backup_reserve"]))["backup_reserve"]
    revision = setting_revision(identity, before)
    appliance.values["backup_soc"] = 15
    with pytest.raises(SafetyError, match="changed"):
        await journal.apply("stale-local", [("backup_soc", 30)],
                            context={"key": "backup_reserve", "expected_revision": revision})
    assert appliance.writes == []
