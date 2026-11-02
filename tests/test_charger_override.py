"""Charger identity, paced command traffic and restart-visible overrides."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from test_control_session import NOW, Store, setup
from test_owner_control_runtime import runtime

from custom_components.sigen_hybrid.core.chargers import configured_units
from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.local_control import LocalControlSession, LocalControlSettings
from custom_components.sigen_hybrid.core.modbus import ModbusTransport
from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits
from custom_components.sigen_hybrid.core.recovery import RecoveryJournal
from custom_components.sigen_hybrid.core.registers import READ_REGISTERS, WRITE_REGISTERS


def test_charger_units_are_explicit_or_unique_matching_endpoint_never_guessed():
    data = {"host": "test.invalid", "port": 502}
    peer = {"plant_connection": data, "ac_charger_connections": {"one": {**data, "slave_id": 3}},
            "inverter_connections": {"two": {**data, "slave_id": 7, "inverter_has_dccharger": True}}}
    assert configured_units(data) == {"ac": None, "dc": None}
    assert configured_units(data, [peer]) == {"ac": 3, "dc": 7}
    assert configured_units({**data, "ac_charger_unit_id": 4}, [peer])["ac"] == 4
    assert configured_units({**data, "host": "other.invalid"}, [peer]) == {"ac": None, "dc": None}
    peer["ac_charger_connections"]["another"] = {**data, "slave_id": 6}
    assert configured_units(data, [peer])["ac"] is None
    with pytest.raises(ValueError):
        configured_units({**data, "ac_charger_unit_id": 247})


class Appliance:
    def __init__(self):
        self.values, self.calls, self.seconds = {}, [], 0
        defaults = {"remote_ems": 0, "remote_mode": 2, "charge_limit_kw": 5, "discharge_limit_kw": 5,
                    "backup_soc": 10, "charge_cutoff_soc": 95, "discharge_cutoff_soc": 10,
                    "grid_sensor_connected": 1, "grid_state": 0, "running_state": 1, "soc": 50}
        for key, value in defaults.items():
            reg = READ_REGISTERS.get(key) or WRITE_REGISTERS[key]
            self.values.update({reg.address + i: word for i, word in enumerate(reg.encode(value))})

    async def sleep(self, delay):
        self.seconds += delay
        await asyncio.sleep(0)

    async def read_input_registers(self, *, address, count, device_id):
        self.calls.append(("input", address, count, device_id, self.seconds))
        if address == 30515:
            raw = b"INVERTER-TEST".ljust(20, b"\0")
            words = [int.from_bytes(raw[i:i+2], "big") for i in range(0, 20, 2)]
        else:
            words = [self.values.get(address+i, 0) for i in range(count)]
        return SimpleNamespace(registers=words, isError=lambda: False)

    async def read_holding_registers(self, **kwargs):
        return await self.read_input_registers(**kwargs)

    async def write_registers(self, *, address, values, device_id):
        self.calls.append(("write", address, len(values), device_id, self.seconds))
        self.values.update({address+i: value for i, value in enumerate(values)})
        return SimpleNamespace(isError=lambda: False)


def transport(appliance, **kwargs):
    value = ModbusTransport(appliance, **kwargs)
    value.clock, value.sleep = lambda: appliance.seconds, appliance.sleep
    return value


async def test_charger_states_are_read_from_exact_devices_not_zero_watts():
    appliance = Appliance()
    appliance.values.update({32000: 2, 31513: 0, 32003: 0, 32004: 0, 31502: 0, 31503: 0})
    local = transport(appliance, read_only=True, charger_units={"ac": 3, "dc": 7})
    assert await local.charger_readings() == {"ac_state": "Reserving", "dc_state": "Idle", "ac_power": 0, "dc_power": 0}
    assert [(a, unit) for _, a, _, unit, _ in appliance.calls] == [(32000, 3), (32003, 3), (31513, 7), (31502, 7)]
    appliance.values[32000] = 65535
    assert "ac_state" not in await local.charger_readings()
    assert not any(row[0] == "write" for row in appliance.calls)


async def test_grouped_local_hold_keeps_pacing_identity_and_fresh_write_readback():
    appliance = Appliance()
    local = transport(appliance)

    async def identity():
        assert await local.device_identity(7) == "INVERTER-TEST"
        return "synthetic"

    def clock():
        return NOW + timedelta(seconds=appliance.seconds)
    settings = LocalControlSettings(local, identity, max_charge_kw=5, max_discharge_kw=5, clock=clock)
    journal = RecoveryJournal(Store(), settings, plant_identity="synthetic", clock=clock)
    controller = Controller(SafetyLimits(), executor=LocalControlSession(journal, clock=clock))
    async with local.command():
        result = await controller.execute(Intent(Mode.HOLD), setup()[-1], NOW, dry_run=False)
    assert result.status == "confirmed"
    writes = [row for row in appliance.calls if row[0] == "write"]
    assert len(writes) == 5  # Two SOC bounds, two power limits, enable; mode was already self-consumption.
    for index, row in enumerate(appliance.calls):
        if row[0] == "write":
            assert appliance.calls[index-1][1] == 30515
            assert appliance.calls[index+1][1] == row[1]
    assert all(b[4]-a[4] >= 1 for a, b in zip(appliance.calls, appliance.calls[1:]))
    assert appliance.seconds <= 52
    assert any(row[1:3] == (40047, 2) for row in appliance.calls)


async def test_normal_poll_waits_for_command_and_resumes_even_after_cancellation():
    appliance = Appliance()
    local = transport(appliance)
    start = asyncio.Event()

    async def poll():
        await start.wait()
        return await local.read("soc")

    task = asyncio.create_task(poll())
    async with local.command():
        start.set()
        await asyncio.sleep(0)
        await local.read("remote_mode")
        assert not task.done()
    assert await task == 50
    assert [row[1] for row in appliance.calls] == [40031, 30014]
    with pytest.raises(asyncio.CancelledError):
        async with local.command():
            raise asyncio.CancelledError
    assert await local.read("soc") == 50


async def test_restart_shows_recovering_override_then_verified_action_and_expiry():
    controls, coordinator, appliance, store, clock, _ = runtime()
    await controls.submit(Intent(Mode.HOLD, duration_minutes=60))
    await controls._job
    original = controls.operation
    assert original["mode"] == "hold" and original["duration_minutes"] == 60
    restarted, runtime2, _, _, _, _ = runtime(store=store, appliance=appliance)
    await restarted.restore_status()
    assert restarted.operation["phase"] == "recovery_pending"
    assert runtime2.controller.manual_until is None
    await restarted.reconcile()
    assert restarted.operation["mode"] == "hold" and restarted.operation["phase"] == "confirmed"
    assert runtime2.controller.manual_until.isoformat() == original["expires_at"].isoformat()
    await restarted.cancel()
    await restarted._job
    assert restarted.operation["phase"] == "restored"
    await controls.close()
    await restarted.close()
