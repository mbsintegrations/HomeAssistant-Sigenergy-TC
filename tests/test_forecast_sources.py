"""Use real adapter code with inert HA doubles; no provider network requests."""

import ast
from datetime import datetime, timedelta, timezone
from math import isfinite
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.forecasts import (
    PROVIDERS,
    ForecastPoint,
    average_points,
    energy_for_horizon,
    entity_points,
    merge_points,
    timestamp,
)

NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)


def adapter():
    tree = ast.parse(Path("custom_components/sigen_hybrid/forecast_sources.py").read_text())
    loaded = object()
    scope = {"timedelta": timedelta, "isfinite": isfinite, "ConfigEntryState": SimpleNamespace(LOADED=loaded), "PROVIDERS": PROVIDERS, "ForecastPoint": ForecastPoint, "average_points": average_points, "energy_for_horizon": energy_for_horizon, "entity_points": entity_points, "merge_points": merge_points, "timestamp": timestamp, "utcnow": lambda: NOW}
    rows, states, entries = [], {}, {}
    scope["er"] = SimpleNamespace(async_get=lambda hass: rows, async_entries_for_config_entry=lambda registry, identity: [row for row in rows if row.config_entry_id == identity])
    exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))], type_ignores=[]), "forecast_sources.py", "exec"), scope)
    hass = SimpleNamespace(states=SimpleNamespace(get=states.get), config_entries=SimpleNamespace(async_get_entry=entries.get))
    return scope, hass, rows, states, entries, loaded


def test_average_aligns_hourly_and_quarter_hour_energy_without_filling_gaps():
    hourly = [ForecastPoint(NOW, NOW + timedelta(hours=1), 2)]
    quarters = [ForecastPoint(NOW + timedelta(minutes=15*i), NOW + timedelta(minutes=15*(i+1)), 4) for i in range(4)]
    assert energy_for_horizon(average_points([hourly, quarters]), NOW, NOW + timedelta(hours=1)) == 3
    assert len(average_points([hourly, quarters[:1] + quarters[2:]])) == 3
    with pytest.raises(ValueError, match="cover"):
        energy_for_horizon(average_points([hourly, quarters[:1] + quarters[2:]]), NOW, NOW + timedelta(hours=1))


async def test_open_meteo_reads_only_cached_registered_daily_sensors_and_interval_energy():
    scope, hass, rows, states, entries, loaded = adapter()
    entry = SimpleNamespace(entry_id="meteo", domain="open_meteo_solar_forecast", state=loaded, title="Whole plant")
    entries[entry.entry_id] = entry
    for day, total, offset in (("today", "12000", 0), ("tomorrow", "9000", 24)):
        entity_id = f"sensor.meteo_{day}"
        rows.append(SimpleNamespace(entity_id=entity_id, config_entry_id="meteo", platform=entry.domain, disabled_by=None, unique_id=f"meteo_energy_production_{day}"))
        states[entity_id] = SimpleNamespace(state=total, last_reported=NOW, attributes={"unit_of_measurement": "Wh", "wh_period_15m": {(NOW + timedelta(hours=offset)).isoformat(): 250}})
    result = await scope["read_source"](hass, {"provider": entry.domain, "entry_id": "meteo"}, NOW, None)
    assert result["available"] and result["today_kwh"] == 12 and result["tomorrow_kwh"] == 9
    assert result["series"][0]["power_kw"] == 1 and result["series"][0]["energy_kwh"] == .25
    states["sensor.meteo_today"].state = "unavailable"
    result = await scope["read_source"](hass, {"provider": entry.domain, "entry_id": "meteo"}, NOW, None)
    assert not result["available"] and "today_kwh" not in result


def test_daily_mean_excludes_unavailable_sources_instead_of_zero():
    scope, *_ = adapter()
    rows = [{"name": "A", "available": True, "today_kwh": 10, "tomorrow_kwh": 6, "source_updated_at": NOW.isoformat(), "series": []}, {"name": "B", "available": True, "today_kwh": 14, "tomorrow_kwh": 10, "source_updated_at": NOW.isoformat(), "series": []}]
    result = scope["combine_sources"](rows, True)
    assert result["today_kwh"] == 12 and result["tomorrow_kwh"] == 8 and result["source_count"] == 2
    rows[1]["available"] = False
    result = scope["combine_sources"](rows, True)
    assert result["today_kwh"] == 10 and result["source_count"] == 1 and result["provider"] == "A"


async def test_more_than_two_average_sources_rejected_before_any_provider_read():
    scope, hass, *_ = adapter()
    sources = [{"provider": "forecast_solar", "entry_id": str(index)} for index in range(3)]
    with pytest.raises(ValueError, match="at most two"):
        await scope["source_results"](hass, {"sources": sources, "average": True}, NOW, None)


def test_forecast_only_preferences_do_not_reload_connections_but_other_changes_do():
    tree = ast.parse(Path("custom_components/sigen_hybrid/__init__.py").read_text())
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "async_reload_entry")
    calls = []
    async def forecast(hass, options):
        calls.append("forecast")
        return {"available": True}
    async def reload(identity):
        calls.append("reload")
    scope = {"async_forecast_overview": forecast}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "__init__.py", "exec"), scope)
    runtime = SimpleNamespace(non_forecast_configuration=({"host": "local.invalid"}, {"cloud": {"saved": True}}), async_update_listeners=lambda: calls.append("listeners"))
    entry = SimpleNamespace(entry_id="tc", data={"host": "local.invalid"}, options={"cloud": {"saved": True}, "forecast": {"sources": []}}, runtime_data=runtime)
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_reload=reload))
    import asyncio
    asyncio.run(scope["async_reload_entry"](hass, entry))
    assert calls == ["forecast", "listeners"]
    entry.options["safety"] = {"reserve_soc": 30}
    asyncio.run(scope["async_reload_entry"](hass, entry))
    assert calls[-1] == "reload"
