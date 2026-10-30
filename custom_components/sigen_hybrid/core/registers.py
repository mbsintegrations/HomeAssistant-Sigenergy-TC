"""Narrow register allowlist adapted from TypQxQ/Sigenergy-Local-Modbus.

Copyright (c) 2025 Andrei Ignat. MIT; see licenses/TypQxQ-MIT.txt.
Upstream register definition blob: b040b69320e5a07df351dc6233ab68aa76fe65df.
Addresses are absolute protocol addresses. Never try alternate offsets on writes.
"""

import struct
from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class Register:
    address: int
    count: int = 1
    gain: float = 1
    signed: bool = False
    holding: bool = False

    def decode(self, values: list[int]) -> float:
        if len(values) != self.count or any(not 0 <= v <= 65535 for v in values):
            raise ValueError("Invalid register response length or word")
        raw = b"".join(struct.pack(">H", v) for v in values)
        return int.from_bytes(raw, "big", signed=self.signed) / self.gain

    def encode(self, value: float) -> list[int]:
        if not isfinite(value):
            raise ValueError("Non-finite register value")
        scaled = round(value * self.gain)
        raw = scaled.to_bytes(self.count * 2, "big", signed=self.signed)
        return list(struct.unpack(">" + "H" * self.count, raw))


READ_REGISTERS = {
    "grid_sensor_connected": Register(30004),
    "native_mode": Register(30003),
    "grid_kw": Register(30005, 2, 1000, True),
    "grid_state": Register(30009),
    "max_active_kw": Register(30010, 2, 1000),
    "soc": Register(30014, 1, 10),
    "pv_kw": Register(30035, 2, 1000),
    "battery_kw": Register(30037, 2, 1000, True),
    "max_charge_kw": Register(30068, 2, 1000),
    "max_discharge_kw": Register(30070, 2, 1000),
    "running_state": Register(30051),
    "capacity_kwh": Register(30083, 2, 100),
    "home_kw": Register(30282, 2, 1000, True),
    "total_load_kw": Register(30284, 2, 1000, True),
}

WRITE_REGISTERS = {
    "remote_ems": Register(40029, holding=True),
    "remote_mode": Register(40031, holding=True),
    "charge_limit_kw": Register(40032, 2, 1000, holding=True),
    "discharge_limit_kw": Register(40034, 2, 1000, holding=True),
    "pv_limit_kw": Register(40036, 2, 1000, holding=True),
    "grid_export_limit_kw": Register(40038, 2, 1000, holding=True),
    "grid_import_limit_kw": Register(40040, 2, 1000, holding=True),
    "backup_soc": Register(40046, 1, 10, holding=True),
    "charge_cutoff_soc": Register(40047, 1, 10, holding=True),
    "discharge_cutoff_soc": Register(40048, 1, 10, holding=True),
}
# Optional plant energy registers (same absolute addresses and gains as upstream).
# Keep separate from essential control telemetry: unsupported energy registers
# must never take working power/SoC readings offline.
ENERGY_REGISTERS = {
    "solar_lifetime": Register(30088, 4, 100),
    "home_today": Register(30092, 2, 100),
    "home_lifetime": Register(30094, 4, 100),
    "battery_charge_lifetime": Register(30200, 4, 100),
    "battery_discharge_lifetime": Register(30204, 4, 100),
    "dc_plant_lifetime": Register(30208, 4, 100),
    "dc_discharge_lifetime": Register(30212, 4, 100),
    "grid_import_lifetime": Register(30216, 4, 100),
    "grid_export_lifetime": Register(30220, 4, 100),
    "ac_plant_lifetime": Register(30232, 4, 100),
}
# Grid-code, protection and installer credentials are never writable here.
REMOTE_MODES = {"hold": 1, "self_consumption": 2, "charge": 4, "discharge": 5}


def optional_limit(value: float) -> float | None:
    """Normalize the uint32 unset marker; never use it as an equipment rating."""
    return None if not isfinite(value) or value >= 4_294_967.294 else value
