"""Crash recovery uses saved settings and fresh reads, never command replay."""

import asyncio
import copy
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.errors import ConfirmationError, SafetyError
from custom_components.sigen_hybrid.core.recovery import RecoveryJournal, canonical

NOW = datetime(2026, 10, 29, 19, tzinfo=timezone.utc)


class Store:
    def __init__(self):
        self.value = None
        self.saves = 0
        self.fail = False

    async def async_load(self):
        return copy.deepcopy(self.value)

    async def async_save(self, value):
        self.saves += 1
        if self.fail:
            raise OSError("Storage unavailable")
        self.value = copy.deepcopy(value)


class Plant:
    def __init__(self, store):
        self.store = store
        self.target = "test-plant"
        self.settings = {"power": 2, "mode": 2, "enabled": False}
        self.writes = []
        self.reads = 0
        self.fail_key = None
        self.failure = TimeoutError
        self.ignore_write = False

    async def identity(self):
        return self.target

    def validate(self, key, value):
        if key not in self.settings or type(value) is not {"power": int, "mode": int, "enabled": bool}[key]:
            raise SafetyError("Unknown setting or invalid setting type")

    def matches(self, key, requested, observed):
        return canonical(requested) == canonical(observed)

    async def read(self, keys):
        self.reads += 1
        return {key: self.settings[key] for key in keys}

    async def write(self, key, value):
        assert self.store.value["active"] is not None, "Settings must be durable before writing"
        self.writes.append((key, value))
        if not self.ignore_write:
            self.settings[key] = value
        if key == self.fail_key:
            self.fail_key = None
            raise self.failure()


def setup():
    store = Store()
    plant = Plant(store)
    now = [NOW]
    journal = RecoveryJournal(store, plant, plant_identity="test-plant", clock=lambda: now[0])
    return store, plant, now, journal


async def test_every_write_has_a_durable_original_value_and_restore_is_reverse_order():
    store, plant, now, journal = setup()
    result = await journal.apply(
        "first", [("power", 3), ("mode", 4), ("enabled", True)], expires_at=NOW + timedelta(minutes=30)
    )
    assert result["phase"] == "confirmed"
    assert [s["before"] for s in store.value["active"]["steps"]] == [2, 2, False]
    await journal.restore()
    assert plant.writes == [("power", 3), ("mode", 4), ("enabled", True), ("enabled", False), ("mode", 2), ("power", 2)]
    assert store.value["active"] is None


async def test_duplicate_request_never_repeats_a_plant_command():
    store, plant, now, journal = setup()
    args = ("same", [("mode", 4)])
    first = await journal.apply(*args, expires_at=NOW + timedelta(minutes=30))
    assert await journal.apply(*args, expires_at=NOW + timedelta(minutes=30)) == first
    assert plant.writes == [("mode", 4)]
    with pytest.raises(SafetyError, match="different parameters"):
        await journal.apply("same", [("mode", 5)], expires_at=NOW + timedelta(minutes=30))


@pytest.mark.parametrize("failure", [TimeoutError, asyncio.CancelledError])
async def test_reply_lost_after_device_changed_is_reconciled_after_restart_without_replay(failure):
    store, plant, now, journal = setup()
    plant.fail_key, plant.failure = "mode", failure
    with pytest.raises(failure):
        await journal.apply(
            "uncertain", [("power", 3), ("mode", 4), ("enabled", True)], expires_at=NOW + timedelta(minutes=30)
        )
    assert store.value["active"]["phase"] == "uncertain"
    restarted = RecoveryJournal(store, plant, plant_identity="test-plant", clock=lambda: now[0])
    with pytest.raises(ConfirmationError, match="uncertain"):
        await restarted.apply(
            "uncertain", [("power", 3), ("mode", 4), ("enabled", True)], expires_at=NOW + timedelta(minutes=30)
        )
    await restarted.recover_expired()
    assert plant.writes == [("power", 3), ("mode", 4), ("mode", 2), ("power", 2)]
    assert plant.settings == {"power": 2, "mode": 2, "enabled": False}


async def test_store_failure_prevents_any_plant_write():
    store, plant, now, journal = setup()
    store.fail = True
    with pytest.raises(OSError):
        await journal.apply("cannot-persist", [("mode", 4)])
    assert plant.writes == []


async def test_unrestorable_original_settings_block_takeover_before_any_write():
    store, plant, now, journal = setup()
    plant.settings["mode"] = "unknown-original-mode"
    with pytest.raises(SafetyError):
        await journal.apply("no-restore-path", [("power", 3), ("mode", 4)])
    assert plant.writes == []


async def test_readback_mismatch_is_not_reported_as_success_or_retried():
    store, plant, now, journal = setup()
    plant.ignore_write = True
    with pytest.raises(ConfirmationError, match="readback"):
        await journal.apply("not-confirmed", [("mode", 4)])
    assert plant.writes == [("mode", 4)]
    assert (await journal.pending())["phase"] == "uncertain"


async def test_owner_changed_mode_is_preserved_and_not_fought_by_recovery():
    store, plant, now, journal = setup()
    await journal.apply("owner", [("power", 3), ("mode", 4)], expires_at=NOW + timedelta(minutes=30))
    plant.settings["mode"] = 9
    assert (await journal.restore())["phase"] == "superseded"
    assert plant.writes == [("power", 3), ("mode", 4)]
    assert plant.settings["mode"] == 9


async def test_expiry_is_restored_after_restart_and_never_extended_by_replay():
    store, plant, now, journal = setup()
    expiry = NOW + timedelta(minutes=30)
    await journal.apply("expired", [("mode", 4)], expires_at=expiry)
    now[0] = expiry + timedelta(seconds=1)
    restarted = RecoveryJournal(store, plant, plant_identity="test-plant", clock=lambda: now[0])
    assert (await restarted.recover_expired())["phase"] == "restored"
    assert (await restarted.apply("expired", [("mode", 4)], expires_at=expiry))["phase"] == "restored"
    assert plant.writes == [("mode", 4), ("mode", 2)]


async def test_unexpired_confirmed_command_is_rearmed_without_a_new_write():
    store, plant, now, journal = setup()
    await journal.apply("active", [("mode", 4)], expires_at=NOW + timedelta(minutes=30))
    assert (await journal.recover_expired())["phase"] == "confirmed"
    assert plant.writes == [("mode", 4)]


async def test_a_different_plant_cannot_receive_recovery_writes():
    store, plant, now, journal = setup()
    await journal.apply("identity", [("mode", 4)], expires_at=NOW + timedelta(minutes=30))
    plant.target = "another-plant"
    with pytest.raises(SafetyError, match="identity changed"):
        await journal.restore()
    assert plant.writes == [("mode", 4)]


async def test_saved_checkpoint_for_another_plant_is_rejected():
    store, plant, now, journal = setup()
    store.value = {"version": 1, "plant_identity": "wrong-plant", "active": None, "history": []}
    with pytest.raises(SafetyError, match="another plant"):
        await journal.pending()
    assert plant.reads == 0 and plant.writes == []


async def test_noop_settings_are_not_written():
    store, plant, now, journal = setup()
    await journal.apply("noop", [("mode", 2)])
    await journal.restore("noop")
    assert plant.writes == []


async def test_persistent_change_can_be_rolled_back_from_its_saved_checkpoint():
    store, plant, now, journal = setup()
    assert (await journal.apply("persistent", [("power", 3)]))["phase"] == "committed"
    assert await journal.pending() is None
    restarted = RecoveryJournal(store, plant, plant_identity="test-plant", clock=lambda: now[0])
    assert (await restarted.restore("persistent"))["phase"] == "restored"
    assert plant.writes == [("power", 3), ("power", 2)]


async def test_a_timeout_while_restoring_does_not_cause_a_duplicate_restore_write():
    store, plant, now, journal = setup()
    await journal.apply("restore", [("mode", 4)], expires_at=NOW + timedelta(minutes=30))
    plant.fail_key = "mode"
    with pytest.raises(TimeoutError):
        await journal.restore()
    assert (await journal.recover_expired())["phase"] == "restored"
    assert plant.writes == [("mode", 4), ("mode", 2)]


@pytest.mark.parametrize("changes", [[("arbitrary_register", 1)], [("mode", True)], [("mode", 4), ("mode", 5)], []])
async def test_invalid_or_unallowlisted_change_is_rejected_before_reads_or_writes(changes):
    store, plant, now, journal = setup()
    with pytest.raises(SafetyError):
        await journal.apply("invalid", changes)
    assert plant.reads == 0 and plant.writes == []


@pytest.mark.parametrize("delta", [0, -1, 86401])
async def test_invalid_expiry_never_reaches_the_plant(delta):
    store, plant, now, journal = setup()
    with pytest.raises(SafetyError, match="expiry"):
        await journal.apply("expiry", [("mode", 4)], expires_at=NOW + timedelta(seconds=delta))
    assert plant.reads == 0 and plant.writes == []
