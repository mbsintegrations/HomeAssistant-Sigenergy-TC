"""Persistent daily energy from native cumulative counters, never sampled power."""

from datetime import datetime
from math import isfinite
from zoneinfo import ZoneInfo

DAILY_COUNTERS = {
    "solar_today": "solar_lifetime",
    "battery_charge_today": "battery_charge_lifetime",
    "battery_discharge_today": "battery_discharge_lifetime",
    "grid_import_today": "grid_import_lifetime",
    "grid_export_today": "grid_export_lifetime",
    "ac_today": "ac_plant_lifetime",
    "dc_today": "dc_plant_lifetime",
    "dc_discharge_today": "dc_discharge_lifetime",
}


def energy_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value >= 0


class DailyEnergyCounters:
    def __init__(self, timezone="UTC"):
        self.timezone = ZoneInfo(timezone)
        self.records = {}

    def restore(self, saved):
        if not isinstance(saved, dict) or saved.get("timezone") != str(self.timezone):
            return
        for key, row in saved.get("records", {}).items():
            if key not in DAILY_COUNTERS or not isinstance(row, dict):
                continue
            try:
                stamp = datetime.fromisoformat(row["observed_at"])
                if stamp.tzinfo is None or row["date"] != stamp.astimezone(self.timezone).date().isoformat():
                    continue
                if not energy_number(row["last"]) or row.get("baseline") is not None and not energy_number(row["baseline"]):
                    continue
                self.records[key] = dict(row)
            except (KeyError, TypeError, ValueError):
                continue

    def dump(self):
        return {"timezone": str(self.timezone), "records": self.records}

    def seed(self, daily_key, lifetime, daily, observed_at, latest, now):
        """One-time migration of an aligned same-day counter pair, not a feed."""
        if daily_key not in DAILY_COUNTERS or not all(energy_number(v) for v in (lifetime, daily, latest)):
            raise ValueError("Invalid energy counter pair")
        if observed_at.tzinfo is None or now.tzinfo is None:
            raise ValueError("Counter timestamps must be aware")
        day = now.astimezone(self.timezone).date().isoformat()
        if observed_at.astimezone(self.timezone).date().isoformat() != day or not 0 <= (now - observed_at).total_seconds() <= 86400:
            raise ValueError("Counter pair must be from today")
        if lifetime < daily or latest < lifetime:
            raise ValueError("Counter pair disagrees with native cumulative energy")
        old = self.records.get(daily_key, {})
        if old.get("date") == day and old.get("baseline") is not None:
            raise ValueError("Today's baseline is already established")
        self.records[daily_key] = {"date": day, "baseline": round(lifetime - daily, 6), "last": latest, "observed_at": now.isoformat()}

    def update(self, values, observed_at):
        if observed_at.tzinfo is None:
            raise ValueError("Counter timestamp must be aware")
        day = observed_at.astimezone(self.timezone).date().isoformat()
        result = dict(values)
        for daily, cumulative in DAILY_COUNTERS.items():
            value = values.get(cumulative)
            if not energy_number(value):
                continue
            old = self.records.get(daily)
            baseline = old.get("baseline") if old and old["date"] == day else None
            if old and old["date"] != day:
                previous = datetime.fromisoformat(old["observed_at"])
                # A continuous midnight transition can carry the last sample;
                # an overnight outage cannot invent the missing midnight total.
                if 0 <= (observed_at - previous).total_seconds() <= 120:
                    baseline = old["last"]
            if old and value < old["last"]:
                # A brief invalid zero must not destroy a valid day's baseline.
                result.pop(cumulative, None)
                continue
            self.records[daily] = {"date": day, "baseline": baseline, "last": value, "observed_at": observed_at.isoformat()}
            if baseline is not None and value >= baseline:
                result[daily] = round(value - baseline, 6)
        return result
