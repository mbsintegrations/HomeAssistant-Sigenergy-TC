"""Read cached forecasts from user-selected Home Assistant integrations."""

from datetime import timedelta
from math import isfinite

from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers import entity_registry as er

from .core.forecasts import PROVIDERS, energy_for_horizon, entity_points, forecast_solar_points, merge_points, timestamp
from .core.models import utcnow


def provider_entries(hass, provider):
    info = PROVIDERS[provider]
    return [e for e in hass.config_entries.async_entries(info["domain"]) if e.state is ConfigEntryState.LOADED]


async def async_forecast_overview(hass, options, now=None):
    """Read native daily sensors and cached intervals without claiming a complete plan."""
    provider = options.get("provider", "none")
    if options.get("sources") or provider in ("open_meteo_solar_forecast", "solcast", "volcast", "ensemble"):
        from .forecast_sources import async_sources_overview

        return await async_sources_overview(hass, options, now=now, solar_reader=async_forecast_overview)
    info = PROVIDERS.get(provider)
    result = {
        "provider": info["name"] if info else provider,
        "available": False,
        "today_kwh": None,
        "tomorrow_kwh": None,
        "source_updated_at": None,
        "series_available": False,
        "series": [],
        "series_has_gaps": False,
        "series_coverage": "provider_intervals_only",
        "series_zero_filled": False,
    }
    if provider == "none":
        return {**result, "reason": "No forecast provider selected"}
    if provider != "forecast_solar":
        return {**result, "reason": "Daily overview is not supported for this provider yet"}
    entry_id = options.get("entry_id")
    if entry_id not in {entry.entry_id for entry in provider_entries(hass, provider)}:
        return {**result, "reason": "Selected forecast integration is not loaded"}
    now = now or utcnow()
    try:
        registry = er.async_get(hass)
        rows = er.async_entries_for_config_entry(registry, entry_id)
        observed = []
        values = {}
        for day in ("today", "tomorrow"):
            expected_id = f"{entry_id}_energy_production_{day}"
            matches = [
                row
                for row in rows
                if row.config_entry_id == entry_id
                and row.platform == "forecast_solar"
                and not row.disabled_by
                and row.unique_id == expected_id
            ]
            if len(matches) != 1:
                raise ValueError
            state = hass.states.get(matches[0].entity_id)
            if state is None or str(state.state).lower() in ("unknown", "unavailable", "none", ""):
                raise ValueError
            updated = timestamp(getattr(state, "last_reported", None) or state.last_updated)
            age = (now - updated).total_seconds()
            if age < -5 or age > 21600:
                raise ValueError
            factor = {"Wh": 0.001, "kWh": 1, "MWh": 1000}.get(state.attributes.get("unit_of_measurement"))
            if factor is None or isinstance(state.state, bool):
                raise ValueError
            value = float(state.state) * factor
            if not isfinite(value) or value < 0:
                raise ValueError
            values[f"{day}_kwh"] = value
            observed.append(updated)
        result.update(available=True, source_updated_at=min(observed).isoformat(), **values)
    except Exception:
        return {**result, "reason": "Daily forecast sensors are unavailable, stale or incompatible"}
    try:
        response = await hass.services.async_call(
            "forecast_solar",
            "get_forecast",
            {"config_entry": entry_id, "resolution": "hourly"},
            blocking=True,
            return_response=True,
        )
        points = forecast_solar_points(response)
        result.update(
            series_available=True,
            series=[
                {
                    "start": point.start.isoformat(),
                    "end": point.end.isoformat(),
                    "power_kw": point.power_kw,
                    "energy_kwh": point.energy_between(point.start, point.end),
                }
                for point in points
            ],
            series_has_gaps=any(a.end < b.start for a, b in zip(points, points[1:])),
        )
    except Exception:
        result["series_reason"] = "Cached hourly intervals are unavailable; daily totals remain independent"
    return result


async def async_forecast(hass, options, start=None):
    provider = options.get("provider", "none")
    if options.get("sources") or provider in ("open_meteo_solar_forecast", "ensemble"):
        from .forecast_sources import async_sources_plan

        return await async_sources_plan(hass, options, start=start)
    if provider == "none":
        return {"available": False, "reason": "No forecast provider selected"}
    info = PROVIDERS[provider]
    if not provider_entries(hass, provider):
        return {"available": False, "reason": "Provider integration is not configured and loaded"}
    start = start or utcnow()
    end = start + timedelta(hours=24)
    try:
        if provider == "forecast_solar":
            entry_id = options["entry_id"]
            if entry_id not in {e.entry_id for e in provider_entries(hass, provider)}:
                raise ValueError("Selected provider configuration is no longer available")
            # The native service filters on hourly bucket starts. Include the
            # current partial hour, then clip its energy to the true horizon.
            request_start = start.replace(minute=0, second=0, microsecond=0)
            response = await hass.services.async_call(
                "forecast_solar",
                "get_forecast",
                {
                    "config_entry": entry_id,
                    "start": request_start.isoformat(),
                    "end": end.isoformat(),
                    "resolution": "hourly",
                },
                blocking=True,
                return_response=True,
            )
            points = forecast_solar_points(response)
        else:
            points = []
            for entity_id in options.get("entities", []):
                state = hass.states.get(entity_id)
                if state is None or state.state in ("unknown", "unavailable"):
                    raise ValueError("Selected forecast sensor is unavailable")
                if (start - state.last_updated).total_seconds() > 21600:
                    raise ValueError("Selected forecast sensor has not updated within six hours")
                points.extend(entity_points(provider, state.attributes))
            points = merge_points(points)
        energy = energy_for_horizon(points, start, end)
        return {
            "available": True,
            "provider": info["name"],
            "solar_24h_kwh": round(energy, 3),
            "updated_at": start.isoformat(),
            "points": len(points),
            "horizon_hours": 24,
        }
    except Exception:
        return {
            "available": False,
            "provider": info["name"],
            "reason": "Forecast unavailable, stale or incomplete; no zero substitution",
        }
