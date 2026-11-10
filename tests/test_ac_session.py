"""Session tests use inert providers; no real charger commands."""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.ac_session import ACChargeSession
from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.recovery import canonical


class Store:
    value = None

    async def async_load(self):
        return deepcopy(self.value)

    async def async_save(self, value):
        self.value = deepcopy(value)


class Plant:
    def __init__(self):
        self.devices = {"ac_charging": "test-charger"}
        self.target = "test-plant"
        self.mode = {"mode": 1, "grid_charging": False, "max_grid_power_kw": 3,
                     "battery_boost": False, "cutoff_soc": 70,
                     "discharge_power_kw": None, "stop_discharging_soc": None}
        self.status = 2
        self.writes = []
        self.fail_start = False
        self.fail_mode = False
        self.offline = False

    async def identity(self):
        return self.target

    async def read(self, keys):
        if self.offline:
            raise TimeoutError()
        return {key: deepcopy(self.mode) for key in keys}

    def validate(self, key, value):
        assert key == "ac_charge_mode" and set(value) == set(self.mode)

    def matches(self, key, requested, observed):
        return canonical(requested) == canonical(observed)

    async def write(self, key, value):
        self.writes.append((key, deepcopy(value)))
        if key == "ac_charge_mode":
            self.mode = deepcopy(value)
            if self.fail_mode:
                self.fail_mode = False
                raise TimeoutError()
        elif value:
            if self.fail_start:
                raise TimeoutError()
        else:
            self.status = 2

    async def charger_state(self, key):
        if self.offline:
            raise TimeoutError()
        return self.status


def setup():
    state, mode, plant = Store(), Store(), Plant()
    now = [datetime(2026, 11, 5, tzinfo=timezone.utc)]

    async def provider(serial, writing):
        assert serial in (None, "test-charger")
        return plant

    manager = ACChargeSession(state, mode, provider, clock=lambda: now[0], operation_lock=asyncio.Lock())
    return manager, plant, now


async def start(manager, temporary=True):
    preview = await manager.preview("owner", "test-charger")
    request = manager.consume("owner", preview["token"], temporary)
    await manager.start(request)


async def test_preview_cancel_and_wrong_user_never_write():
    manager, plant, now = setup()
    preview = await manager.preview("owner", None)
    assert preview["surplus"]
    with pytest.raises(SafetyError):
        manager.consume("other-user", preview["token"], True)
    now[0] += timedelta(minutes=4)
    with pytest.raises(SafetyError):
        manager.consume("owner", preview["token"], True)
    assert plant.writes == []


async def test_changed_settings_and_duplicate_token_cannot_start():
    manager, plant, _ = setup()
    preview = await manager.preview("owner", None)
    request = manager.consume("owner", preview["token"], True)
    with pytest.raises(SafetyError):
        manager.consume("owner", preview["token"], True)
    plant.mode["max_grid_power_kw"] = 2
    await manager.start(request)
    assert plant.writes == []
    assert manager.state["phase"] == "failed"


async def test_temporary_fast_preserves_limits_then_restores_after_session():
    manager, plant, now = setup()
    baseline = deepcopy(plant.mode)
    await start(manager)
    assert plant.mode == {**baseline, "mode": 0, "grid_charging": True}
    assert manager.state["phase"] == "waiting"
    plant.status = 3
    await manager.poll()
    assert manager.state["phase"] == "charging"
    plant.status = 2
    await manager.poll()
    now[0] += timedelta(seconds=30)
    await manager.poll()
    assert plant.mode["mode"] == 0  # A brief pause is not an ended session.
    now[0] += timedelta(seconds=31)
    await manager.poll()
    assert plant.mode == baseline
    assert manager.state["phase"] == "finished"
    assert [row for row in plant.writes if row[0] == "ac_charging"] == [("ac_charging", True)]


async def test_explicit_stop_restores_without_replaying_start():
    manager, plant, _ = setup()
    await start(manager)
    plant.status = 3
    await manager.stop("test-charger")
    assert plant.mode["mode"] == 1
    assert not manager.state["active"]
    assert [row for row in plant.writes if row[0] == "ac_charging"] == [
        ("ac_charging", True), ("ac_charging", False)]


async def test_owner_changes_preserved_on_restore():
    manager, plant, now = setup()
    await start(manager)
    plant.mode["max_grid_power_kw"] = 2
    now[0] += timedelta(minutes=4)
    await manager.poll()
    assert plant.mode["max_grid_power_kw"] == 2
    assert manager.state["phase"] == "superseded"
    assert len(plant.writes) == 2


@pytest.mark.parametrize("lost_mode_reply", [True, False])
async def test_restart_and_lost_reply_restore_but_never_replay(lost_mode_reply):
    manager, plant, now = setup()
    plant.fail_mode = lost_mode_reply
    plant.fail_start = not lost_mode_reply
    await start(manager)
    restarted = ACChargeSession(manager.state_store, manager.mode_store, manager.provider,
        clock=manager.clock, operation_lock=asyncio.Lock())
    await restarted.load()
    now[0] += timedelta(minutes=4)
    await restarted.poll()
    assert plant.mode["mode"] == 1
    starts = [row for row in plant.writes if row[0] == "ac_charging"]
    assert len(starts) == (0 if lost_mode_reply else 1)


async def test_outage_and_changed_identity_do_not_send_recovery_to_other_plant():
    manager, plant, now = setup()
    await start(manager)
    plant.offline = True
    now[0] += timedelta(hours=25)
    await manager.poll()
    assert manager.state["phase"] == "recovery_pending"
    plant.offline = False
    plant.target = "another-plant"
    await manager.poll()
    assert len(plant.writes) == 2
    plant.target = "test-plant"
    await manager.poll()
    assert plant.mode["mode"] == 1


async def test_normal_start_waiting_is_not_failed_or_restored():
    manager, plant, now = setup()
    await start(manager, False)
    now[0] += timedelta(minutes=4)
    await manager.poll()
    assert manager.state["phase"] == "waiting"
    assert plant.writes == [("ac_charging", True)]
    assert not manager.state["active"]


async def test_start_durable_state_failure_prevents_all_plant_writes():
    manager, plant, _ = setup()

    async def fail(value):
        raise OSError("No disk space")

    preview = await manager.preview("owner", None)
    request = manager.consume("owner", preview["token"], True)
    manager.state_store.async_save = fail
    with pytest.raises(OSError):
        await manager.start(request)
    assert plant.writes == []
