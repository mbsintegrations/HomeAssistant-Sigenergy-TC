"""Validated, timezone-aware owner rules; no network or HA dependency."""

import json
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from hashlib import sha256
from math import isfinite
from zoneinfo import ZoneInfo

from .models import Intent, Mode, Source
from .tariffs import minute

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
ACTIONS = {"charge": Mode.CHARGE, "discharge": Mode.DISCHARGE, "hold": Mode.HOLD,
           "battery_export": Mode.DISCHARGE, "export": Mode.HOLD}


@dataclass(frozen=True)
class Strategy:
    identity: str
    name: str
    start: int
    end: int
    weekdays: tuple[int, ...]
    condition: str
    soc: float | None
    action: str
    priority: int
    enabled: bool
    power_kw: float | None = None
    export_kw: float | None = None

    @classmethod
    def from_dict(cls, identity, value):
        if not isinstance(identity, str) or not 1 <= len(identity) <= 128 or not isinstance(value, dict):
            raise ValueError("Invalid strategy identity")
        if type(value.get("enabled")) is not bool:
            raise ValueError("Choose whether this strategy is enabled")
        start, end = minute(value["start"]), minute(value["end"])
        if start >= 1440 or start == end:
            raise ValueError("Use a distinct start/end, or 00:00–24:00 for all day")
        days = value["weekdays"]
        if not isinstance(days, list) or not days or len(set(days)) != len(days) or any(d not in DAYS for d in days):
            raise ValueError("Select valid, distinct weekdays")
        condition, soc, action, priority = value["condition"], value.get("soc"), value["action"], value["priority"]
        if condition not in ("above", "below", "none") or action not in ACTIONS:
            raise ValueError("Unsupported strategy condition or action")
        if condition != "none" and (type(soc) not in (int, float) or not isfinite(soc) or not 0 <= soc <= 100):
            raise ValueError("Use a finite SOC threshold between 0 and 100")
        if type(priority) is not int or not 0 <= priority <= 100:
            raise ValueError("Strategy priority must be 0–100")
        name = value.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise ValueError("Use a strategy name of at most 80 characters")
        power, export = value.get("power_kw"), value.get("export_kw")
        for kw in (power, export):
            if kw is not None and (type(kw) not in (int, float) or not isfinite(kw) or not .001 <= kw <= 100):
                raise ValueError("Custom power must be finite, 0.001–100 kW")
        if action == "export" and value["enabled"] and export is None:
            raise ValueError("Solar export requires an explicit export limit")
        return cls(identity, name, start, end, tuple(DAYS.index(day) for day in days), condition,
                   soc if condition != "none" else None, action, priority, value["enabled"], power, export)

    def period(self, now, zone):
        local = now.astimezone(ZoneInfo(zone))
        current = local.hour*60+local.minute
        anchor = local.date()
        if self.end > self.start:
            inside = self.start <= current < self.end
        else:
            inside = current >= self.start or current < self.end
            if current < self.end:
                anchor -= timedelta(days=1)
        if not self.enabled or not inside or anchor.weekday() not in self.weekdays:
            return None
        end_date = anchor + timedelta(days=int(self.end <= self.start or self.end == 1440))
        end_minute = self.end % 1440
        end = datetime.combine(end_date, time(end_minute//60, end_minute%60), tzinfo=local.tzinfo).astimezone(timezone.utc)
        # A repeated wall-clock interval cannot create a second dispatch after
        # the first occurrence of an ambiguous end. Missing times move forward.
        if end <= now:
            return None
        return anchor.isoformat(), end

    def matches_soc(self, soc):
        if type(soc) not in (int, float) or not isfinite(soc):
            return False
        return self.condition == "none" or (soc > self.soc if self.condition == "above" else soc < self.soc)

    def fingerprint(self):
        return sha256(json.dumps(vars(self), sort_keys=True).encode()).hexdigest()[:20]

    def intent(self, now, zone, limits):
        period = self.period(now, zone)
        if period is None:
            raise ValueError("The strategy is outside its time window")
        anchor, end = period
        deadline = min(end, now+timedelta(minutes=15))
        minutes = int((deadline-now).total_seconds()//60)
        if minutes < 1:
            raise ValueError("Less than one whole minute remains")
        mode = ACTIONS[self.action]
        power = self.power_kw or (limits.max_charge_kw if mode == Mode.CHARGE else limits.max_discharge_kw)
        identity = sha256(f"{self.identity}:{self.fingerprint()}:{anchor}:{now.isoformat()}".encode()).hexdigest()
        return Intent(mode, Source.AUTOMATION, minutes, power if mode in (Mode.CHARGE, Mode.DISCHARGE) else None,
                      self.action == "battery_export", f"strategy-{identity[:40]}",
                      reserve_soc=self.soc if self.condition == "above" else None,
                      charge_ceiling_soc=self.soc if self.condition == "below" else None,
                      deadline=deadline, strategy_id=f"{self.identity}:{self.fingerprint()}",
                      solar_export_kw=self.export_kw if self.action == "export" else None)


def choose_strategy(values, now, zone, soc):
    if not isinstance(values, dict) or len(values) > 64:
        raise ValueError("Use at most 64 strategies")
    rules = [Strategy.from_dict(identity, value) for identity, value in values.items()]
    matches = [rule for rule in rules if rule.period(now, zone) and rule.matches_soc(soc)]
    if not matches:
        return None
    best = max(rule.priority for rule in matches)
    winners = [rule for rule in matches if rule.priority == best]
    if len(winners) != 1:
        raise ValueError("Matching strategies have the same priority; choose a distinct priority")
    return winners[0]
