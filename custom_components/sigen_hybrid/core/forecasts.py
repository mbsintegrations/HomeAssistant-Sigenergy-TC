"""Normalize installed HA providers; never make duplicate provider-cloud calls."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import isfinite

PROVIDERS = {
    "open_meteo_solar_forecast": {
        "name": "Open-Meteo Solar Forecast",
        "domain": "open_meteo_solar_forecast",
        "url": "https://github.com/rany2/ha-open-meteo-solar-forecast",
        "install": "Install Open-Meteo Solar Forecast through HACS and configure the same panels as your other forecast sources.",
    },
    "solcast": {
        "name": "Solcast",
        "domain": "solcast_solar",
        "url": "https://github.com/BJReplay/ha-solcast-solar",
        "install": "Install Solcast PV Solar via HACS, restart HA, add the integration and configure your sites/API key.",
    },
    "forecast_solar": {
        "name": "Forecast.Solar",
        "domain": "forecast_solar",
        "url": "https://www.home-assistant.io/integrations/forecast_solar/",
        "install": "Add Forecast.Solar in Settings > Devices & services and configure your panel location, orientation and capacity.",
    },
    "volcast": {
        "name": "Volcast",
        "domain": "volcast",
        "url": "https://github.com/volter-labs/volcast-ha-integration",
        "install": "Install Volcast through HACS, restart HA and configure the credentials required by your Volcast account.",
    },
}


def timestamp(value) -> datetime:
    result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Forecast points need timezone-aware timestamps")
    return result.astimezone(timezone.utc)


@dataclass(frozen=True)
class ForecastPoint:
    start: datetime
    end: datetime
    power_kw: float

    def __post_init__(self):
        if self.start.tzinfo is None or self.end.tzinfo is None or self.end <= self.start:
            raise ValueError("Invalid forecast interval")
        if not isfinite(self.power_kw) or self.power_kw < 0:
            raise ValueError("Forecast power must be finite and non-negative")

    def energy_between(self, start: datetime, end: datetime) -> float:
        hours = max(0, (min(self.end, end) - max(self.start, start)).total_seconds()) / 3600
        return hours * self.power_kw


def entity_points(provider: str, attributes: dict) -> tuple[ForecastPoint, ...]:
    if provider == "solcast":
        rows = attributes.get("detailedForecast")
        minutes = 30
        if not rows:
            rows, minutes = attributes.get("detailedHourly"), 60
        if not rows:
            raise ValueError("Solcast detailed forecast attributes are not enabled or available")
        points = [
            ForecastPoint(
                timestamp(row["period_start"]),
                timestamp(row["period_start"]) + timedelta(minutes=minutes),
                float(row["pv_estimate"]),
            )
            for row in rows
        ]
    elif provider == "volcast":
        rows = attributes.get("detailedHourly")
        if rows:
            # Energy per hourly interval is authoritative, not an instantaneous
            # power field. A one-hour interval makes kWh numerically equal to kW.
            points = [
                ForecastPoint(
                    timestamp(row["period_start"]),
                    timestamp(row["period_start"]) + timedelta(hours=1),
                    float(row["energy_kwh"]),
                )
                for row in rows
            ]
        else:
            rows = attributes.get("detailedForecast")
            if not rows:
                raise ValueError("Volcast detailed forecast attributes are unavailable")
            points = [
                ForecastPoint(
                    timestamp(row["period_start"]),
                    timestamp(row["period_start"]) + timedelta(minutes=5),
                    float(row["energy_wh"]) / 1000 * 12,
                )
                for row in rows
            ]
    else:
        raise ValueError("This provider does not expose the supported entity-series format")
    return merge_points(points)


def forecast_solar_points(response: dict) -> tuple[ForecastPoint, ...]:
    """HA forecast_solar.get_forecast response requested at hourly resolution."""
    rows = response.get("wh_period")
    if not isinstance(rows, dict) or not rows:
        raise ValueError("Forecast.Solar hourly energy data is unavailable")
    return merge_points(
        [
            ForecastPoint(timestamp(start), timestamp(start) + timedelta(hours=1), float(wh) / 1000)
            for start, wh in rows.items()
        ]
    )


def merge_points(points) -> tuple[ForecastPoint, ...]:
    unique = {}
    for point in points:
        key = (point.start, point.end)
        if key in unique and unique[key] != point:
            raise ValueError("Conflicting duplicate forecast intervals")
        unique[key] = point
    ordered = sorted(unique.values(), key=lambda p: p.start)
    if any(a.end > b.start for a, b in zip(ordered, ordered[1:])):
        raise ValueError("Overlapping forecast intervals")
    return tuple(ordered)


def energy_for_horizon(points, start: datetime, end: datetime) -> float:
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Invalid forecast horizon")
    cursor = start
    energy = 0.0
    for point in merge_points(points):
        if point.end <= start or point.start >= end:
            continue
        if point.start > cursor:
            raise ValueError("Forecast does not fully cover the requested horizon")
        energy += point.energy_between(start, end)
        cursor = min(end, point.end)
    if cursor < end:
        raise ValueError("Forecast does not fully cover the requested horizon")
    return energy


def average_points(sources):
    """Average energy-equivalent interval powers on common UTC coverage.

    Providers may use 5, 15, 30 or 60 minute intervals. Missing intervals remain
    gaps; they are never treated as zero production or interpolated over.
    """
    streams = [merge_points(points) for points in sources if points]
    if not streams:
        return ()
    boundaries = sorted({clock for points in streams for point in points for clock in (point.start, point.end)})
    positions = [0] * len(streams)
    result = []
    for start, end in zip(boundaries, boundaries[1:]):
        powers = []
        for index, points in enumerate(streams):
            while positions[index] < len(points) and points[positions[index]].end <= start:
                positions[index] += 1
            if positions[index] == len(points):
                break
            point = points[positions[index]]
            if point.start > start or point.end < end:
                break
            powers.append(point.power_kw)
        if len(powers) == len(streams):
            result.append(ForecastPoint(start, end, sum(powers) / len(powers)))
    return tuple(result)
