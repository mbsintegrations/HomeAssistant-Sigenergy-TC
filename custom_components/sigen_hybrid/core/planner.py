"""Advisory low-cost charging plan. It never dispatches or enables export."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import isfinite

from .errors import SafetyError
from .models import SafetyLimits, Snapshot
from .tariffs import TariffPlan


@dataclass(frozen=True)
class Forecast:
    observed_at: datetime
    solar_kwh: float
    demand_kwh: float
    horizon_hours: int = 24
    uncertainty: float = 0.25
    source: str = "user_input"

    def validate(self, now: datetime):
        if self.observed_at.tzinfo is None or now.tzinfo is None:
            raise ValueError("Forecast timestamps must be timezone-aware")
        age = (now - self.observed_at).total_seconds()
        if age < -5 or age > 21600:
            raise SafetyError("Forecast is stale or from the future")
        if any(not isfinite(x) or x < 0 for x in (self.solar_kwh, self.demand_kwh)):
            raise ValueError("Forecast energy must be finite and non-negative")
        if not 0 <= self.uncertainty <= 1 or self.horizon_hours != 24:
            raise ValueError("This planner requires a 24-hour forecast and uncertainty 0-1")


def charging_plan(
    snapshot: Snapshot,
    limits: SafetyLimits,
    tariff: TariffPlan,
    forecast: Forecast,
    now: datetime,
    *,
    efficiency: float = 0.9,
) -> dict:
    snapshot.validate(now, limits.telemetry_max_age)
    forecast.validate(now)
    if not 0 < efficiency <= 1:
        raise ValueError("Efficiency must be greater than zero and at most one")
    floor = max(limits.reserve_soc, snapshot.backup_soc, snapshot.discharge_cutoff_soc)
    ceiling = min(limits.charge_ceiling_soc, snapshot.charge_cutoff_soc)
    if floor >= ceiling:
        raise SafetyError("Reserve conflicts with the charging ceiling")
    conservative_solar = forecast.solar_kwh * (1 - forecast.uncertainty)
    conservative_demand = forecast.demand_kwh * (1 + forecast.uncertainty)
    target = min(
        ceiling, max(floor, floor + 100 * max(0, conservative_demand - conservative_solar) / snapshot.capacity_kwh)
    )
    energy = max(0, (target - snapshot.soc) / 100 * snapshot.capacity_kwh) / efficiency
    maximum = min(limits.max_charge_kw, snapshot.max_charge_kw)
    if maximum <= 0:
        raise SafetyError("No valid charging power is available")
    # Iterate UTC instants. DST days cannot duplicate or omit elapsed time slots.
    start = now.astimezone(timezone.utc)
    slots = []
    for i in range(48):
        time = start + timedelta(minutes=30 * i)
        slots.append((tariff.rate_at(time), time))
    chosen, remaining = [], energy
    for rate, time in sorted(slots):
        if remaining <= 0.000001:
            break
        slot_energy = min(maximum * 0.5, remaining)
        chosen.append(
            {
                "start": time.isoformat(),
                "duration_minutes": 30,
                "power_kw": round(slot_energy / 0.5, 3),
                "energy_kwh": round(slot_energy, 6),
                "rate": str(rate),
            }
        )
        remaining -= slot_energy
    return {
        "advisory_only": True,
        "strategy": "lowest_cost_charging",
        "currency": tariff.currency,
        "target_soc": round(target, 2),
        "import_kwh": round(energy - remaining, 6),
        "unserved_kwh": round(max(0, remaining), 6),
        "estimated_charge_cost": round(sum(float(s["rate"]) * s["energy_kwh"] for s in chosen), 4),
        "export_permitted": limits.export_permitted,
        "forecast_source": forecast.source,
        "forecast_uncertainty": forecast.uncertainty,
        "slots": sorted(chosen, key=lambda s: s["start"]),
        "limitations": [
            "Aggregate energy balance, not an hourly household-flow simulation",
            "No dispatch, battery-export or source-routing commands are generated",
            "Wear, clipping and changing forecasts are not yet priced",
        ],
    }
