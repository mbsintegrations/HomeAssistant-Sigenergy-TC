"""Exercise Controller -> native provider -> durable recovery with fake I/O."""

import copy
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.control_providers import CloudControlSettings
from custom_components.sigen_hybrid.core.control_session import CloudControlSession
from custom_components.sigen_hybrid.core.errors import ConfirmationError, SafetyError, TransportError
from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits, Snapshot, Source
from custom_components.sigen_hybrid.core.recovery import RecoveryJournal

NOW = datetime(2026, 10, 30, 3, tzinfo=timezone.utc)


class Store:
    value = None

    async def async_load(self):
        return copy.deepcopy(self.value)

    async def async_save(self, value):
        self.value = copy.deepcopy(value)


class Appliance:
    station_id = "42"

    def __init__(self, clock):
        self.clock, self.calls, self.lost_reply = clock, [], False
        self.levels = {
            "chargeSOC": "100.0",
            "dischargeSOC": "0.0",
            "backupSOC": "0.0",
            "peakShavingSOC": "",
            "ja12SOC": "0.0",
        }
        self.manual = {"enable": False}
        self.export = {"currentEnable": False, "ownerSetEnable": None, "installerSetEnable": None}
        self.expose_power = True

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if "/battery/level/" in path:
            return copy.deepcopy(self.levels)
        if "/instant/manunal/" in path:
            return copy.deepcopy(self.manual)
        if "/battery/export/limitation/" in path:
            return copy.deepcopy(self.export)
        raise AssertionError(path)

    async def _envelope(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        value = kwargs["json"]
        if path.endswith("/battery/level"):
            self.levels.update({k: "" if v is None else v for k, v in value.items() if k != "stationId"})
        elif path.endswith("/battery/export/limitation"):
            self.export.update(currentEnable=value["ownerSetEnable"], ownerSetEnable=value["ownerSetEnable"])
        elif path.endswith("/instant/manunal"):
            self.manual = {"enable": value["enable"]}
            if value["enable"]:
                self.manual.update(mode=value["mode"], endTime=self.clock().timestamp() + int(value["duration"]) * 60)
                if self.expose_power:
                    self.manual["powerLimitation"] = value["powerLimitation"]
            if self.lost_reply:
                self.lost_reply = False
                raise TimeoutError("Synthetic reply loss after appliance accepted the command")
        else:
            raise AssertionError(path)
        return {"code": 0, "data": True}


def setup(export=False):
    clock = [NOW]
    appliance, store = Appliance(lambda: clock[0]), Store()
    provider = CloudControlSettings(appliance, "42", clock=lambda: clock[0])
    journal = RecoveryJournal(store, provider, plant_identity="cloud:42", clock=lambda: clock[0])
    session = CloudControlSession(journal, clock=lambda: clock[0])
    controller = Controller(SafetyLimits(export_permitted=export), executor=session)
    snapshot = Snapshot(NOW, 50, 0, 2, 2, 0, 20, 5, 5)
    return clock, appliance, store, journal, session, controller, snapshot


async def test_real_execution_path_enforces_home_only_block_and_restores_effective_settings():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    result = await controller.execute(Intent(Mode.DISCHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    assert result.status == "confirmed" and result.route == "cloud"
    assert appliance.export["currentEnable"] is True
    assert appliance.levels["dischargeSOC"] == "20"
    assert appliance.levels["chargeSOC"] == "90"
    writes = [c for c in appliance.calls if c[0] != "GET"]
    assert [c[1] for c in writes] == [
        "device/energy-profile/battery/level",
        "device/energy-profile/battery/export/limitation",
        "device/energy-profile/instant/manunal",
    ]
    assert store.value["active"]["context"]["export_requested"] is False
    await session.release()
    assert appliance.manual == {"enable": False}
    assert appliance.export["currentEnable"] is False
    assert float(appliance.levels["chargeSOC"]) == 100 and float(appliance.levels["dischargeSOC"]) == 0
    assert appliance.levels["ja12SOC"] == "0.0"


async def test_export_needs_owner_permission_before_any_provider_request():
    *_, controller, snapshot = setup()
    with pytest.raises(SafetyError, match="Export permission"):
        await controller.execute(
            Intent(Mode.DISCHARGE, power_kw=2, export_requested=True), snapshot, NOW, dry_run=False
        )


async def test_permitted_grid_discharge_uses_unblocked_native_direction():
    clock, appliance, store, journal, session, controller, snapshot = setup(export=True)
    await controller.execute(Intent(Mode.DISCHARGE, power_kw=2, export_requested=True), snapshot, NOW, dry_run=False)
    assert appliance.export["currentEnable"] is False
    assert appliance.manual["mode"] == "1"


async def test_power_readback_absence_is_reported_as_partial_confirmation():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    appliance.expose_power = False
    result = await controller.execute(Intent(Mode.CHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    assert result.status == "partially_confirmed" and "power-limit readback" in result.message


async def test_duplicate_id_after_a_restart_does_not_extend_the_override_or_send_another_command():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    intent = Intent(Mode.CHARGE, power_kw=2, request_id="same")
    first = await controller.execute(intent, snapshot, NOW, dry_run=False)
    writes = len([c for c in appliance.calls if c[0] != "GET"])
    clock[0] += timedelta(minutes=1)
    restarted = CloudControlSession(
        RecoveryJournal(store, journal.provider, plant_identity="cloud:42", clock=lambda: clock[0]),
        clock=lambda: clock[0],
    )
    result = await restarted.execute(controller.preview(intent, snapshot, NOW), snapshot, clock[0])
    assert result.expires_at == first.expires_at
    assert len([c for c in appliance.calls if c[0] != "GET"]) == writes
    altered = Intent(Mode.CHARGE, power_kw=1, request_id="same")
    with pytest.raises(SafetyError, match="different parameters"):
        await restarted.execute(controller.preview(altered, snapshot, NOW), snapshot, clock[0])


async def test_reply_loss_is_not_retried_and_is_reconciled_by_release():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    appliance.lost_reply = True
    intent = Intent(Mode.CHARGE, power_kw=2, request_id="lost")
    with pytest.raises(TransportError):
        await controller.execute(intent, snapshot, NOW, dry_run=False)
    before = len([c for c in appliance.calls if c[0] != "GET"])
    with pytest.raises(ConfirmationError):
        await controller.execute(intent, snapshot, NOW, dry_run=False)
    assert len([c for c in appliance.calls if c[0] != "GET"]) == before
    assert (await session.reconcile())["phase"] == "restored"
    assert appliance.manual == {"enable": False}


async def test_expired_native_lease_is_released_without_replaying_the_original_action():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    await controller.execute(Intent(Mode.HOLD, duration_minutes=1), snapshot, NOW, dry_run=False)
    clock[0] += timedelta(minutes=2)
    appliance.manual = {"enable": False}  # Native device expiry.
    assert (await session.reconcile())["phase"] == "restored"
    assert appliance.manual == {"enable": False}


async def test_non_manual_requests_cannot_take_over_the_owners_native_override():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    appliance.manual = {"enable": True, "mode": "0", "endTime": NOW.timestamp() + 5000}
    with pytest.raises(SafetyError, match="owner"):
        await controller.execute(Intent(Mode.CHARGE, Source.AUTOMATION, power_kw=2), snapshot, NOW, dry_run=False)
    assert all(c[0] == "GET" for c in appliance.calls)


@pytest.mark.parametrize(
    "mode,export,power", [(Mode.CHARGE, True, 2), (Mode.DISCHARGE, False, True), (Mode.HOLD, "yes", None)]
)
async def test_invalid_power_or_export_intent_is_rejected_before_provider_io(mode, export, power):
    clock, appliance, store, journal, session, controller, snapshot = setup(export=True)
    with pytest.raises(SafetyError):
        await controller.execute(Intent(mode, power_kw=power, export_requested=export), snapshot, NOW, dry_run=False)
    assert not appliance.calls and store.value is None


async def test_owner_disabling_export_block_during_preparation_prevents_manual_discharge():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    original_read = appliance._data
    manual_reads = 0

    async def racing_read(method, path, **kwargs):
        nonlocal manual_reads
        if "/instant/manunal/" in path:
            manual_reads += 1
            if manual_reads == 4:  # Owner changes the switch during the final manual-state check.
                appliance.export["currentEnable"] = False
        return await original_read(method, path, **kwargs)

    appliance._data = racing_read
    with pytest.raises(SafetyError, match="protection changed"):
        await controller.execute(Intent(Mode.DISCHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    assert not any(c[0] == "PUT" and c[1].endswith("/instant/manunal") for c in appliance.calls)
    assert store.value["active"]["phase"] == "uncertain"


async def test_checked_battery_write_preserves_owner_change_during_its_last_read():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    provider = journal.provider
    baseline = (await provider.read(["battery_levels"]))["battery_levels"]
    target = {**baseline, "charge_soc": 90}
    original_read = appliance._data
    reads = 0

    async def racing_read(method, path, **kwargs):
        nonlocal reads
        if "/battery/level/" in path:
            reads += 1
            if reads == 2:
                appliance.levels["chargeSOC"] = "85"
        return await original_read(method, path, **kwargs)

    appliance._data = racing_read
    with pytest.raises(SafetyError, match="owner changed"):
        await provider.write_checked("battery_levels", target, baseline)
    assert appliance.levels["chargeSOC"] == "85"
    assert all(c[0] == "GET" for c in appliance.calls)


async def test_stop_still_releases_our_manual_command_when_the_owner_changes_other_settings():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    await controller.execute(Intent(Mode.CHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    appliance.levels["chargeSOC"] = "85"  # Independent owner adjustment.
    before = len(appliance.calls)
    result = await session.release()
    assert result["phase"] == "superseded" and result["released_on_conflict"] == ["manual"]
    assert appliance.manual == {"enable": False} and appliance.levels["chargeSOC"] == "85"
    assert all(c[1].endswith("/instant/manunal") for c in appliance.calls[before:] if c[0] != "GET")


async def test_stop_preserves_a_new_native_override_that_no_longer_belongs_to_us():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    await controller.execute(Intent(Mode.CHARGE, power_kw=2), snapshot, NOW, dry_run=False)
    appliance.manual = {"enable": True, "mode": "2", "endTime": NOW.timestamp() + 1000}
    before = len(appliance.calls)
    result = await session.release()
    assert result["phase"] == "superseded" and appliance.manual["mode"] == "2"
    assert all(c[0] == "GET" for c in appliance.calls[before:])


async def test_repeating_an_ended_receipt_after_restart_does_not_reclaim_manual_ownership():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    intent = Intent(Mode.CHARGE, power_kw=2)
    await controller.execute(intent, snapshot, NOW, dry_run=False)
    await session.release()
    before = len(appliance.calls)
    restarted = Controller(controller.limits, executor=session)
    result = await restarted.execute(intent, snapshot, NOW, dry_run=False)
    assert result.status == "restored" and restarted.manual_until is None
    assert appliance.manual == {"enable": False} and len(appliance.calls) == before
