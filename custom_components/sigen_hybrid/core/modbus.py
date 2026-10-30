"""Serialized, paced Modbus I/O. A timed-out write is never repeated."""

from __future__ import annotations

import asyncio
import inspect
import time
from datetime import datetime, timezone
from typing import Any

from .errors import ConfirmationError, SafetyError, TransportError
from .models import Snapshot
from .registers import ENERGY_REGISTERS, READ_REGISTERS, WRITE_REGISTERS, optional_limit


class ModbusTransport:
    def __init__(self, client: Any, *, plant_id: int = 247, request_interval: float = 1.0, read_only: bool = False):
        if plant_id != 247:
            raise ValueError("Sigenergy plant registers require unit 247")
        if request_interval < 1:
            raise ValueError("Protocol request interval must be at least one second")
        self.client = client
        self.plant_id = plant_id
        self.request_interval = request_interval
        self.read_only = read_only
        self.trace = {"read_requests": 0, "write_requests": 0, "errors": 0, "snapshots": 0}
        self._lock = asyncio.Lock()
        self._last_request = float("-inf")

    async def close(self):
        result = self.client.close()
        if inspect.isawaitable(result):
            await result

    async def _call(self, method, *, _device_id=None, **kwargs):
        writing = method.__name__.startswith("write")
        device_id = self.plant_id if _device_id is None else _device_id
        if device_id != self.plant_id and (writing or type(device_id) is not int or not 1 <= device_id <= 246):
            raise SafetyError("Only device identity reads may target the selected inverter")
        if writing and self.read_only:
            raise SafetyError("This additional Modbus connection is read-only")
        async with self._lock:
            await asyncio.sleep(max(0, self.request_interval - (time.monotonic() - self._last_request)))
            self._last_request = time.monotonic()
            self.trace["write_requests" if writing else "read_requests"] += 1
            self.trace["last_address"] = kwargs.get("address")
            self.trace["last_request_at"] = datetime.now(timezone.utc).isoformat()
            # Pin a pymodbus version and use its documented device_id argument.
            try:
                result = await method(device_id=device_id, **kwargs)
                if result.isError():
                    raise TransportError("Device rejected the Modbus request")
                self.trace["last_success_at"] = datetime.now(timezone.utc).isoformat()
                return result
            except TransportError:
                self.trace["errors"] += 1
                raise
            except Exception:
                self.trace["errors"] += 1
                # Never include response bodies, hosts or client repr in diagnostics.
                raise TransportError("Modbus request failed; inspect current state before retrying") from None

    async def device_identity(self, unit_id: int) -> str:
        """V2.9 inverter serial, 30515/10; no scanning or guessed device IDs."""
        if type(unit_id) is not int or not 1 <= unit_id <= 246:
            raise SafetyError("Configure the primary inverter unit ID before local control")
        response = await self._call(self.client.read_input_registers, _device_id=unit_id, address=30515, count=10)
        try:
            words = response.registers
            if len(words) != 10:
                raise ValueError
            serial = b"".join(int(word).to_bytes(2, "big") for word in words).decode("ascii").strip("\x00 ")
            if not 1 <= len(serial) <= 20 or not all(char.isalnum() or char in "_-" for char in serial):
                raise ValueError
            return serial
        except (ValueError, TypeError, AttributeError, OverflowError):
            raise SafetyError("The selected inverter did not return a valid serial number") from None

    async def read(self, key: str) -> float:
        reg = READ_REGISTERS.get(key) or WRITE_REGISTERS[key]
        method = self.client.read_holding_registers if reg.holding else self.client.read_input_registers
        result = await self._call(method, address=reg.address, count=reg.count)
        try:
            return reg.decode(result.registers)
        except ValueError, TypeError, AttributeError:
            raise TransportError("Malformed Modbus register response") from None

    async def write_confirmed(self, key: str, value: float) -> None:
        reg = WRITE_REGISTERS[key]  # closed allowlist, never arbitrary addresses
        await self._call(self.client.write_registers, address=reg.address, values=reg.encode(value))
        actual = await self.read(key)  # new device response, not a coordinator cache
        if abs(actual - value) > 0.5 / reg.gain:
            raise ConfirmationError("Write sent but fresh register readback did not match")

    async def snapshot(self) -> Snapshot:
        # Bounded contiguous groups avoid reading unsupported gaps. Fixed addresses,
        # no probing/scanning, no second connection per register.
        # Conservative timestamp: oldest sample, not the end of the read cycle.
        observed_at = datetime.now(timezone.utc)
        started = time.monotonic()
        values = {}
        registers = {
            **READ_REGISTERS,
            **{
                key: WRITE_REGISTERS[key]
                for key in ("remote_ems", "remote_mode", "backup_soc", "charge_cutoff_soc", "discharge_cutoff_soc")
            },
        }
        groups = []
        for key, reg in sorted(registers.items(), key=lambda item: (item[1].holding, item[1].address)):
            if (
                groups
                and groups[-1][-1][1].holding == reg.holding
                and groups[-1][-1][1].address + groups[-1][-1][1].count == reg.address
            ):
                groups[-1].append((key, reg))
            else:
                groups.append([(key, reg)])
        for group in groups:
            first = group[0][1]
            count = sum(reg.count for _, reg in group)
            method = self.client.read_holding_registers if first.holding else self.client.read_input_registers
            result = await self._call(method, address=first.address, count=count)
            try:
                if len(result.registers) != count:
                    raise ValueError("Unexpected grouped register length")
                offset = 0
                for key, reg in group:
                    values[key] = reg.decode(result.registers[offset : offset + reg.count])
                    offset += reg.count
            except ValueError, TypeError, AttributeError:
                raise TransportError("Malformed Modbus register response") from None
        max_active = values["max_active_kw"]
        charge = optional_limit(values["max_charge_kw"])
        discharge = optional_limit(values["max_discharge_kw"])
        if charge is None or discharge is None or max_active <= 0:
            raise SafetyError("Valid battery and inverter ratings are required")
        self.trace["snapshots"] += 1
        energy = await self.energy_readings()
        self.trace["last_cycle_seconds"] = round(time.monotonic() - started, 3)
        return Snapshot(
            observed_at=observed_at,
            soc=values["soc"],
            pv_kw=values["pv_kw"],
            home_kw=values["home_kw"],
            grid_kw=values["grid_kw"],
            battery_kw=values["battery_kw"],
            capacity_kwh=values["capacity_kwh"],
            max_charge_kw=min(charge, max_active),
            max_discharge_kw=min(discharge, max_active),
            backup_soc=values["backup_soc"],
            charge_cutoff_soc=values["charge_cutoff_soc"],
            discharge_cutoff_soc=values["discharge_cutoff_soc"],
            on_grid=values["grid_state"] == 0,
            running=values["running_state"] == 1,
            remote_ems=values["remote_ems"] == 1,
            remote_mode=int(values["remote_mode"]),
            native_mode=int(values["native_mode"]),
            total_load_kw=values["total_load_kw"],
            energy=energy,
        )

    async def energy_readings(self):
        values = {}
        # Three documented contiguous blocks; no gaps, probing or added clients.
        for address, count in ((30088, 10), (30200, 24), (30232, 4)):
            try:
                response = await self._call(self.client.read_input_registers, address=address, count=count)
                if len(response.registers) != count:
                    raise ValueError("Unexpected energy response length")
                for key, reg in ENERGY_REGISTERS.items():
                    if address <= reg.address and reg.address + reg.count <= address + count:
                        offset = reg.address - address
                        words = response.registers[offset:offset + reg.count]
                        if all(word == 65535 for word in words):
                            continue  # device's unavailable marker is not energy
                        values[key] = reg.decode(words)
            except (TransportError, ValueError, TypeError, AttributeError):
                continue
        return values
