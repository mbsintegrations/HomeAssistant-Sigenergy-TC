"""Bounded, cached owner-app history reads using verified chart contracts.

No generic endpoint, credentials, writes or inferred measurements are exposed.
Day charts are power; calendar and lifetime charts are measured energy.
"""

from __future__ import annotations

import asyncio
import calendar
import math
import re
import time
from collections import OrderedDict
from copy import deepcopy
from datetime import date as calendar_date
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc

HISTORY_KINDS = (
    "power",
    "solar",
    "load",
    "battery",
    "grid",
    "soc",
    "price",
    "ac",
    "dc",
    "strings",
    "forecast",
    "battery_temperature",
    "battery_soh",
    "inverter_power",
    "inverter_temperature",
    "grid_voltage",
    "grid_current",
    "grid_frequency",
    "grid_reactive",
    "pv_voltage",
    "pv_current",
    "dc_voltage",
    "dc_current",
    "dc_soc",
    "optimizer",
)
ENERGY_KINDS = frozenset(("power", "solar", "load", "battery", "grid", "ac", "dc"))
DATE_FLAGS = {"day": 1, "week": 2, "month": 3, "year": 4, "lifetime": 5}
COLORS = {
    "solar": "#efc900",
    "battery": "#26c9c8",
    "grid": "#6694ff",
    "home": "#a45bf0",
    "ac": "#b46767",
    "dc": "#d29420",
}
# Provider day charts use positive source / negative destination powers.
DAY_FIELDS = {
    "FROM_SOLAR": ("solar_power", "Solar", "solar", 1),
    "BATTERY": ("battery_power", "Battery", "battery", 1),
    "GRID": ("grid_power", "Grid", "grid", 1),
    "TO_LOAD": ("home_power", "Load", "home", 1),
    "TO_EVAC": ("ac_power", "EVAC", "ac", 1),
    "EVDC": ("dc_power", "EVDC", "dc", 1),
}
PERIOD_FIELDS = {
    "FROM_SOLAR": ("solar_energy", "Solar", "solar", 1),
    "FROM_BATTERY": ("battery_discharge_energy", "Discharged", "battery", 1),
    "TO_BATTERY": ("battery_charge_energy", "Charged", "battery", 1),
    "FROM_GRID": ("grid_import_energy", "Imported", "grid", 1),
    "TO_GRID": ("grid_export_energy", "Exported", "grid", 1),
    "TO_LOAD": ("home_energy", "Load", "home", 1),
    "TO_EVAC": ("ac_energy", "EVAC", "ac", 1),
    "FROM_EVDC": ("dc_discharge_energy", "EVDC discharged", "dc", 1),
    "TO_EVDC": ("dc_charge_energy", "EVDC charged", "dc", 1),
}


def _number(value):
    if isinstance(value, bool) or value is None or not isinstance(value, (str, int, float)):
        return None
    try:
        result = float(value)
    except ValueError, OverflowError:
        return None
    return result if math.isfinite(result) else None


def _estimated(value):
    if not isinstance(value, dict):
        return False
    return any(
        value.get(key) is True
        for key in ("forecast", "predicted", "isForecast", "isPredict", "isPrediction", "typeForecast", "estimated")
    ) or any(
        str(value.get(key, "")).upper() in ("FORECAST", "PREDICT", "PREDICTION", "ESTIMATED")
        for key in ("type", "dataType", "pointType", "sourceType")
    )


def _aware(value):
    if not isinstance(value, str) or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value):
        raise ValueError("An aware history timestamp is required")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def validate_range(period, date, start_time, end_time, zone, now):
    """Accept one bounded calendar interval, never an arbitrary multi-year scan."""
    if (
        period not in ("day", "week", "month", "year")
        or not isinstance(date, str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date)
    ):
        raise ValueError("Choose a supported history calendar period")
    selected = calendar_date.fromisoformat(date)
    start, end = _aware(start_time), _aware(end_time)
    local_start, local_end = start.astimezone(zone), end.astimezone(zone)
    if any(value.hour or value.minute or value.second or value.microsecond for value in (local_start, local_end)):
        raise ValueError("History ranges must follow local calendar boundaries")
    first, after = local_start.date(), local_end.date()
    days = (after - first).days
    if not 1 <= days <= 366 or not first <= selected < after or selected > now.astimezone(zone).date():
        raise ValueError("History range is out of bounds")
    expected_days = {
        "day": 1,
        "week": 7,
        "month": calendar.monthrange(first.year, first.month)[1],
        "year": 366 if calendar.isleap(first.year) else 365,
    }[period]
    if days != expected_days:
        raise ValueError("History range does not match its period")
    if (
        period == "month"
        and (first.day != 1 or after.day != 1)
        or period == "year"
        and (first.month != 1 or first.day != 1 or after.month != 1 or after.day != 1)
    ):
        raise ValueError("History period must begin at its calendar boundary")
    if first.year < 2000 or first > now.astimezone(zone).date():
        raise ValueError("History date is out of bounds")
    return start, end, first.strftime("%Y%m%d"), (after - timedelta(days=1)).strftime("%Y%m%d")


def _point_time(raw, zone):
    if not isinstance(raw, str):
        return None
    try:
        if re.fullmatch(r"\d{8} \d{2}:\d{2}", raw):
            local = datetime.strptime(raw, "%Y%m%d %H:%M")
            first, second = local.replace(tzinfo=zone, fold=0), local.replace(tzinfo=zone, fold=1)
            # The API has no UTC offset/fold. Do not assign an ambiguous hour.
            if first.utcoffset() != second.utcoffset():
                return None
            stamp = first.astimezone(timezone.utc)
            if stamp.astimezone(zone).replace(tzinfo=None) != local:
                return None
            return stamp
        return _aware(raw)
    except ValueError, OverflowError:
        return None


def parse_energy(body, *, period, zone, start, end, now):
    """Preserve provider units/signs and discard predictions after the clock."""
    data = body.get("data", body) if isinstance(body, dict) else {}
    chart = data.get("chartData", {}) if isinstance(data, dict) else {}
    unit = chart.get("unit") if isinstance(chart, dict) else None
    expected = {"W": 0.001, "kW": 1, "MW": 1000} if period == "day" else {"Wh": 0.001, "kWh": 1, "MWh": 1000}
    if unit not in expected:
        return []
    fields = DAY_FIELDS if period == "day" else PERIOD_FIELDS
    result, seen = [], set()
    for item in chart.get("dataSeries", []) if isinstance(chart.get("dataSeries"), list) else []:
        if not isinstance(item, dict) or _estimated(item) or item.get("id") not in fields or item["id"] in seen:
            continue
        seen.add(item["id"])
        key, label, group, sign = fields[item["id"]]
        points = {}
        for point in item.get("points", [])[:20000] if isinstance(item.get("points"), list) else []:
            if not isinstance(point, dict) or _estimated(point):
                continue
            stamp = _point_time(point.get("time"), zone)
            if stamp is None or not start <= stamp < end or stamp > now:
                continue
            if period == "lifetime":
                bucket = stamp.astimezone(zone)
                if bucket.month != 1 or bucket.day != 1 or bucket.hour or bucket.minute or bucket.second:
                    continue
            number = _number(point.get("value"))
            value = None if number is None else number * expected[unit] * sign
            points[int(stamp.timestamp() * 1000)] = value
        result.append(
            {
                "key": key,
                "label": label,
                "color": COLORS[group],
                "unit": "kW" if period == "day" else "kWh",
                "points": [{"time": stamp, "value": value} for stamp, value in sorted(points.items())],
            }
        )
    return result


def parse_tariff_soc(body, *, zone, start, end, now, currency):
    data = body.get("data", body) if isinstance(body, dict) else {}
    fields = {
        "BUY_TARIFF": ("buy_price", "Buying price", "#efc900"),
        "SELL_TARIFF": ("sell_price", "Selling price", "#f79a53"),
        "SOC": ("battery_soc", "Battery SOC", "#26c9c8"),
    }
    result, seen = [], set()
    for item in (
        data.get("dataSeries", []) if isinstance(data, dict) and isinstance(data.get("dataSeries"), list) else []
    ):
        if not isinstance(item, dict) or _estimated(item) or item.get("id") not in fields or item["id"] in seen:
            continue
        seen.add(item["id"])
        key, label, color = fields[item["id"]]
        points = {}
        for point in item.get("points", [])[:20000] if isinstance(item.get("points"), list) else []:
            if not isinstance(point, dict) or _estimated(point):
                continue
            stamp = _point_time(point.get("time"), zone)
            if stamp is None or not start <= stamp < end or stamp > now:
                continue
            value = _number(point.get("value"))
            if key == "battery_soc" and value is not None and not 0 <= value <= 100:
                value = None
            points[int(stamp.timestamp() * 1000)] = value
        result.append(
            {
                "key": key,
                "label": label,
                "color": color,
                "unit": "%" if key == "battery_soc" else f"{currency}/kWh",
                "points": [{"time": stamp, "value": value} for stamp, value in sorted(points.items())],
            }
        )
    return result


def _selected(series, kind, period):
    groups = {
        "solar": ("solar_",),
        "battery": ("battery_",),
        "grid": ("grid_",),
        "load": ("home_",),
        "ac": ("ac_",),
        "dc": ("dc_",),
    }
    if kind == "power":
        return deepcopy(series)
    if kind == "price":
        return deepcopy(series)
    if kind == "soc":
        return deepcopy([item for item in series if item["key"] == "battery_soc"])
    selected = [
        dict(item, points=[dict(point) for point in item["points"]])
        for item in series
        if item["key"].startswith(groups.get(kind, ("__unsupported",)))
    ]
    if kind in ("load", "ac") or kind == "dc" and period == "day":
        for item in selected:
            for point in item["points"]:
                if point["value"] is not None:
                    point["value"] = abs(point["value"]) if kind in ("load", "ac") else -point["value"]
    return selected


class HistoryBroker:
    """One entry-wide cache/lock serves every card and related chart kind."""

    def __init__(self, client, *, timezone, currency, now=None, clock=None):
        self.client = client
        self.zone = ZoneInfo(timezone)
        self.currency = currency if isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency) else "currency"
        self.now = now or (lambda: datetime.now(UTC))
        self.clock = clock or time.monotonic
        self._cache = OrderedDict()
        self._lock = asyncio.Lock()
        self._last_request = float("-inf")
        self._retry_after = float("-inf")

    async def get(self, kind, period, date, start_time, end_time):
        if kind not in HISTORY_KINDS:
            raise ValueError("Unsupported history chart")
        now = self.now()
        if period == "lifetime":
            if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                raise ValueError("Choose a supported history calendar date")
            start, end = _aware(start_time), _aware(end_time)
            selected = calendar_date.fromisoformat(date)
            local_now = now.astimezone(self.zone)
            if (
                not 0 <= start.timestamp() < end.timestamp()
                or end > now + timedelta(days=1)
                or start > now
                or not 2000 <= selected.year
                or selected > local_now.date()
            ):
                raise ValueError("History range is out of bounds")
            # The verified lifetime endpoint returns annual buckets independent
            # of its displayed bounds. Send one fixed current-year query rather
            # than scanning the arbitrary Recorder interval supplied by a card.
            first, last = local_now.strftime("%Y%m%d"), f"{local_now.year}1231"
            start = datetime(2000, 1, 1, tzinfo=self.zone).astimezone(UTC)
            end = datetime(local_now.year + 1, 1, 1, tzinfo=self.zone).astimezone(UTC)
        else:
            start, end, first, last = validate_range(period, date, start_time, end_time, self.zone, now)
        if kind not in ENERGY_KINDS | {"soc", "price"} or period != "day" and kind in ("soc", "price"):
            return {"series": [], "source": "local_recorder", "cached": False, "observed_at": now.isoformat()}
        family = "tariff_soc" if kind in ("soc", "price") else "energy"
        key = (family, period, first, last)
        cached = False
        async with self._lock:
            stored = self._cache.get(key)
            local_midnight = now.astimezone(self.zone).replace(hour=0, minute=0, second=0, microsecond=0)
            ttl = 86400 if end <= local_midnight else 900
            if stored is not None and self.clock() - stored[0] < ttl:
                payload = stored[1]
                self._cache.move_to_end(key)
                cached = True
            else:
                if self.clock() < self._retry_after:
                    return {
                        "series": [],
                        "source": "cloud_unavailable",
                        "cached": False,
                        "observed_at": now.isoformat(),
                    }
                delay = 1 - (self.clock() - self._last_request)
                if delay > 0:
                    await asyncio.sleep(delay)
                self._last_request = self.clock()
                try:
                    if family == "energy":
                        body = await self.client.history_energy(
                            start_date=first, end_date=last, date_flag=DATE_FLAGS[period]
                        )
                        series = parse_energy(body, period=period, zone=self.zone, start=start, end=end, now=now)
                    else:
                        body = await self.client.history_tariff_soc(date=first)
                        series = parse_tariff_soc(
                            body, zone=self.zone, start=start, end=end, now=now, currency=self.currency
                        )
                    payload = {"series": series, "observed_at": now.isoformat()}
                    self._cache[key] = (self.clock(), payload)
                    self._cache.move_to_end(key)
                    while len(self._cache) > 48:
                        self._cache.popitem(last=False)
                except Exception:
                    self._retry_after = self.clock() + 900
                    return {
                        "series": [],
                        "source": "cloud_unavailable",
                        "cached": False,
                        "observed_at": now.isoformat(),
                    }
        result = {
            "series": _selected(payload["series"], kind, period),
            "source": "sigenergy_cloud",
            "cached": cached,
            "observed_at": payload["observed_at"],
            "chartType": "line" if period == "day" else "bar",
        }
        if period == "lifetime":
            times = [
                point["time"] for item in result["series"] for point in item["points"] if point["value"] is not None
            ]
            if times:
                result.update(start=min(times), end=int(end.timestamp() * 1000))
        return result
