"""Optional read-only module telemetry contract; never optimizer actuation.

Tigo module telemetry is a separate provider capability, not inferred from a
Sigenergy string measurement. No TAP/CCA driver is claimed by this prototype.
"""

from dataclasses import dataclass
from datetime import datetime
from math import isfinite


@dataclass(frozen=True)
class ModuleTelemetry:
    provider: str
    module_id: str
    observed_at: datetime
    power_w: float | None = None
    voltage_v: float | None = None
    current_a: float | None = None
    energy_kwh: float | None = None

    def __post_init__(self):
        if not self.provider or not self.module_id or self.observed_at.tzinfo is None:
            raise ValueError("Provider, module identity and aware timestamp are required")
        for value in (self.power_w, self.voltage_v, self.current_a, self.energy_kwh):
            if value is not None and (not isfinite(value) or value < 0):
                raise ValueError("Module readings must be finite, non-negative, or unknown")

    def is_fresh(self, now: datetime, max_age_seconds: int = 1800) -> bool:
        age = (now - self.observed_at).total_seconds()
        return -5 <= age <= max_age_seconds
