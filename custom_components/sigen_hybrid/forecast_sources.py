"""Reuse installed forecast integrations and combine alternative plant forecasts."""

from datetime import timedelta
from math import isfinite

from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers import entity_registry as er

from .core.forecasts import (
    PROVIDERS,
    ForecastPoint,
    average_points,
    energy_for_horizon,
    entity_points,
    merge_points,
    timestamp,
)
from .core.models import utcnow


def source_id(source):
    return f"{source['provider']}:{source['entry_id']}"


def configured_sources(hass, options):
    sources = options.get("sources")
    if sources is None:
        provider = options.get("provider", "none")
        entry_id = options.get("entry_id")
        if provider not in PROVIDERS:
            return []
        if not entry_id and options.get("entities"):
            registry = er.async_get(hass)
            entries = {row.config_entry_id for entity_id in options["entities"] if (row := registry.async_get(entity_id)) is not None}
            if len(entries) == 1:
                entry_id = entries.pop()
        sources = [{"provider": provider, "entry_id": entry_id}] if entry_id else []
    result, seen = [], set()
    for row in sources:
        if not isinstance(row, dict) or row.get("provider") not in PROVIDERS or not isinstance(row.get("entry_id"), str):
            continue
        identity = source_id(row)
        if identity not in seen:
            result.append({"provider": row["provider"], "entry_id": row["entry_id"]})
            seen.add(identity)
    primary = options.get("primary_source")
    return sorted(result, key=lambda row: source_id(row) != primary)


def _rows(hass, source):
    domain = PROVIDERS[source["provider"]]["domain"]
    entry = hass.config_entries.async_get_entry(source["entry_id"])
    if not entry or entry.domain != domain or entry.state is not ConfigEntryState.LOADED:
        raise ValueError("Forecast integration is not loaded")
    registry = er.async_get(hass)
    return entry, [row for row in er.async_entries_for_config_entry(registry, entry.entry_id) if row.platform == domain and not row.disabled_by]


def _daily_state(hass, rows, provider, day, now):
    suffixes = {
        "open_meteo_solar_forecast": [f"_energy_production_{day}"],
        "solcast": [f"_forecast_{day}", f"_total_kwh_forecast_{day}"],
        "volcast": [f"_energy_{day}"],
    }[provider]
    matches = [row for row in rows if any(str(row.unique_id or "").endswith(suffix) for suffix in suffixes)]
    if len(matches) != 1:
        raise ValueError("Daily forecast sensor not found uniquely")
    state = hass.states.get(matches[0].entity_id)
    if state is None or state.state in ("unknown", "unavailable", "none", ""):
        raise ValueError("Daily forecast sensor is unavailable")
    stamp = timestamp(getattr(state, "last_reported", None) or state.last_updated)
    if not -5 <= (now - stamp).total_seconds() <= 21600:
        raise ValueError("Daily forecast sensor is stale")
    factor = {"Wh": .001, "kWh": 1, "MWh": 1000}.get(state.attributes.get("unit_of_measurement"))
    value = float(state.state)
    if factor is None or not isfinite(value) or value < 0:
        raise ValueError("Daily forecast sensor has invalid energy units or value")
    return value * factor, state, stamp


async def read_source(hass, source, now, solar_reader):
    provider = source["provider"]
    result = {**source, "id": source_id(source), "name": PROVIDERS[provider]["name"], "available": False, "series": []}
    try:
        entry, rows = _rows(hass, source)
        result["title"] = entry.title
        if provider == "forecast_solar":
            return {**result, **await solar_reader(hass, {"provider": provider, "entry_id": entry.entry_id}, now), "id": source_id(source), "name": PROVIDERS[provider]["name"]}
        daily = [_daily_state(hass, rows, provider, day, now) for day in ("today", "tomorrow")]
        result.update(available=True, today_kwh=daily[0][0], tomorrow_kwh=daily[1][0], source_updated_at=min(item[2] for item in daily).isoformat())
        try:
            points = []
            for _, state, _ in daily:
                if provider == "open_meteo_solar_forecast":
                    attributes = state.attributes
                    periods = attributes.get("wh_period_15m")
                    minutes = 15
                    if not periods:
                        periods, minutes = attributes.get("wh_period"), 60
                    if not isinstance(periods, dict) or not periods:
                        raise ValueError("Cached interval energy is unavailable")
                    for clock, wh in periods.items():
                        power = float(wh) / 1000 * 60 / minutes
                        points.append(ForecastPoint(timestamp(clock), timestamp(clock) + timedelta(minutes=minutes), power))
                else:
                    points.extend(entity_points(provider, state.attributes))
            points = merge_points(points)
            result["series"] = [{"start": point.start.isoformat(), "end": point.end.isoformat(), "power_kw": point.power_kw, "energy_kwh": point.energy_between(point.start, point.end)} for point in points]
        except (ValueError, TypeError, KeyError):
            pass  # valid daily totals remain independent of detailed intervals
    except (ValueError, TypeError, KeyError):
        result["reason"] = "Source is not providing a fresh compatible daily forecast"
    return result


async def source_results(hass, options, now, solar_reader):
    sources = configured_sources(hass, options)
    if options.get("average") is True and len(sources) > 2:
        raise ValueError("Choose at most two sources to average")
    results = []
    for source in sources:
        row = await read_source(hass, source, now, solar_reader)
        results.append(row)
        if row.get("available") and options.get("average") is not True:
            break
    return results


def combine_sources(results, average=False):
    usable = [row for row in results if row.get("available")]
    chosen = usable if average else usable[:1]
    if not chosen:
        return {"available": False, "provider": "None", "sources": results, "series": [], "reason": "No selected source has a fresh forecast"}
    streams = [tuple(ForecastPoint(timestamp(point["start"]), timestamp(point["end"]), point["power_kw"]) for point in row.get("series", [])) for row in chosen]
    available_streams = [points for points in streams if points]
    points = average_points(available_streams) if average else available_streams[0] if available_streams else ()
    return {
        "available": True,
        "provider": f"Average · {len(chosen)} sources" if average and len(chosen) > 1 else chosen[0]["name"],
        "average": average, "source_count": len(chosen), "sources": results,
        "today_kwh": sum(row["today_kwh"] for row in chosen) / len(chosen),
        "tomorrow_kwh": sum(row["tomorrow_kwh"] for row in chosen) / len(chosen),
        "source_updated_at": min(row["source_updated_at"] for row in chosen),
        "series": [{"start": point.start.isoformat(), "end": point.end.isoformat(), "power_kw": point.power_kw, "energy_kwh": point.energy_between(point.start, point.end)} for point in points],
        "series_available": bool(points), "series_source_count": len(available_streams),
        "series_has_gaps": any(a.end < b.start for a, b in zip(points, points[1:])),
        "series_zero_filled": False,
    }


async def async_sources_overview(hass, options, now=None, solar_reader=None):
    now = now or utcnow()
    try:
        return combine_sources(await source_results(hass, options, now, solar_reader), options.get("average") is True)
    except ValueError:
        return {"available": False, "provider": "None", "series": [], "reason": "Choose at most two sources to average"}


async def async_sources_plan(hass, options, start=None):
    from .forecast import async_forecast_overview

    start = start or utcnow()
    end = start + timedelta(hours=24)
    try:
        rows = await source_results(hass, options, start, async_forecast_overview)
    except ValueError:
        return {"available": False, "reason": "Choose at most two sources to average"}
    valid = []
    for row in rows:
        try:
            points = [ForecastPoint(timestamp(item["start"]), timestamp(item["end"]), item["power_kw"]) for item in row.get("series", [])]
            energy = energy_for_horizon(points, start, end)
            if row.get("available"):
                valid.append((row, energy))
        except (ValueError, TypeError, KeyError):
            continue
    if not valid:
        return {"available": False, "reason": "No selected forecast completely covers the next 24 hours"}
    chosen = valid if options.get("average") is True else valid[:1]
    return {"available": True, "provider": f"Average · {len(chosen)} sources" if len(chosen) > 1 else chosen[0][0]["name"], "solar_24h_kwh": round(sum(energy for _, energy in chosen) / len(chosen), 3), "source_count": len(chosen), "horizon_hours": 24, "updated_at": start.isoformat()}
