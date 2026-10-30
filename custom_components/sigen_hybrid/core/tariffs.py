"""User-owned import/export tariff schedules in major currency units per kWh."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo


def minute(value: str) -> int:
    if value == "24:00":
        return 1440
    try:
        hour, mins = (int(p) for p in value.split(":"))
    except ValueError, AttributeError:
        raise ValueError("Tariff times must be HH:mm") from None
    if not 0 <= hour <= 23 or not 0 <= mins <= 59:
        raise ValueError("Tariff time is outside the day")
    return hour * 60 + mins


def price(value) -> Decimal:
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("Invalid tariff price") from None
    if not result.is_finite():
        raise ValueError("Tariff prices must be finite")
    return result  # negative tariffs are valid


@dataclass(frozen=True)
class TariffWindow:
    start: int
    end: int
    rate: Decimal
    direction: str = "import"
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6)
    months: tuple[int, ...] = tuple(range(1, 13))

    def __post_init__(self):
        if not 0 <= self.start < 1440 or not 0 < self.end <= 1440 or self.start == self.end:
            raise ValueError("Use 00:00-24:00 for an all-day tariff")
        if self.direction not in ("import", "export") or not self.rate.is_finite():
            raise ValueError("Invalid direction or price")
        if not self.weekdays or any(d not in range(7) for d in self.weekdays):
            raise ValueError("Weekdays must be 0 (Monday) through 6")
        if not self.months or any(m not in range(1, 13) for m in self.months):
            raise ValueError("Months must be 1 through 12")

    def contains(self, local: datetime) -> bool:
        current = local.hour * 60 + local.minute
        anchor = local
        if self.end > self.start:
            inside = self.start <= current < self.end
        else:
            inside = current >= self.start or current < self.end
            if current < self.end:
                anchor -= timedelta(days=1)
        return inside and anchor.weekday() in self.weekdays and anchor.month in self.months


@dataclass(frozen=True)
class TariffPlan:
    timezone: str
    currency: str
    default_import: Decimal
    default_export: Decimal
    windows: tuple[TariffWindow, ...] = ()

    def __post_init__(self):
        ZoneInfo(self.timezone)
        if len(self.currency) != 3 or not self.currency.isalpha():
            raise ValueError("Use a three-letter currency code")
        if not self.default_import.is_finite() or not self.default_export.is_finite():
            raise ValueError("Tariff defaults must be finite")

    def rate_at(self, when: datetime, direction: str = "import") -> Decimal:
        if when.tzinfo is None or direction not in ("import", "export"):
            raise ValueError("Use timezone-aware timestamps and a valid direction")
        local = when.astimezone(ZoneInfo(self.timezone))
        matches = [w.rate for w in self.windows if w.direction == direction and w.contains(local)]
        if len(matches) > 1:
            raise ValueError("Overlapping tariff windows are ambiguous")
        return matches[0] if matches else self.default_import if direction == "import" else self.default_export

    @classmethod
    def from_dict(cls, value: dict):
        if value.get("unit") != "major_currency_per_kwh":
            raise ValueError("Declare major_currency_per_kwh; convert cents explicitly")
        windows = tuple(
            TariffWindow(
                minute(w["start"]),
                minute(w["end"]),
                price(w["rate"]),
                w.get("direction", "import"),
                tuple(w.get("weekdays", range(7))),
                tuple(w.get("months", range(1, 13))),
            )
            for w in value.get("windows", [])
        )
        return cls(
            value["timezone"],
            value["currency"].upper(),
            price(value["default_import"]),
            price(value.get("default_export", 0)),
            windows,
        )
