"""Cached daily overview identity, freshness, units and daylight-gap acceptance."""

import ast
from datetime import datetime, timedelta, timezone
from math import isfinite
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.forecasts import PROVIDERS, forecast_solar_points, timestamp

NOW = datetime(2026, 10, 27, 1, tzinfo=timezone.utc)
ENTRY = "synthetic-forecast-entry"


def overview_hass(*, today_unit="kWh", tomorrow_unit="Wh", today="10.5", tomorrow="8500", age=60):
    source = Path("custom_components/sigen_hybrid/forecast.py").read_text()
    tree = ast.parse(source)
    methods = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in ("provider_entries", "async_forecast_overview")
    ]
    loaded = object()
    rows = [
        SimpleNamespace(
            entity_id=f"sensor.native_{day}", config_entry_id=ENTRY, platform="forecast_solar",
            disabled_by=None, unique_id=f"{ENTRY}_energy_production_{day}",
        )
        for day in ("today", "tomorrow")
    ]
    states = {
        f"sensor.native_{day}": SimpleNamespace(
            state=value, attributes={"unit_of_measurement": unit},
            last_reported=NOW-timedelta(seconds=age), last_updated=NOW-timedelta(hours=9),
        )
        for day, value, unit in (("today", today, today_unit), ("tomorrow", tomorrow, tomorrow_unit))
    }
    calls = []
    series = {"wh_period": {
        (NOW+timedelta(hours=6)).isoformat(): 500,
        (NOW+timedelta(hours=7)).isoformat(): 1000,
        (NOW+timedelta(hours=30)).isoformat(): 250,
    }}

    async def cached_call(domain, service, data, **kwargs):
        assert (domain, service) == ("forecast_solar", "get_forecast")
        assert data == {"config_entry": ENTRY, "resolution": "hourly"}
        assert kwargs == {"blocking": True, "return_response": True}
        calls.append(data)
        if isinstance(series.get("error"), Exception):
            raise series["error"]
        return series

    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [SimpleNamespace(entry_id=ENTRY, state=loaded)]),
        states=SimpleNamespace(get=states.get), services=SimpleNamespace(async_call=cached_call),
    )
    scope = {
        "PROVIDERS": PROVIDERS, "ConfigEntryState": SimpleNamespace(LOADED=loaded), "isfinite": isfinite,
        "timestamp": timestamp, "forecast_solar_points": forecast_solar_points, "utcnow": lambda: NOW,
        "er": SimpleNamespace(async_get=lambda hass: rows, async_entries_for_config_entry=lambda registry, entry: registry),
    }
    exec(compile(ast.Module(body=methods, type_ignores=[]), "forecast.py", "exec"), scope)
    return scope["async_forecast_overview"], hass, rows, states, calls, series


async def test_daily_units_and_source_timestamp_are_independent_from_sparse_hourly_series():
    overview, hass, _, states, calls, _ = overview_hass()
    states["sensor.native_tomorrow"].last_reported -= timedelta(seconds=20)
    result = await overview(hass, {"provider": "forecast_solar", "entry_id": ENTRY}, NOW)
    assert result["available"] and result["today_kwh"] == 10.5 and result["tomorrow_kwh"] == 8.5
    assert result["source_updated_at"] == (NOW-timedelta(seconds=80)).isoformat()
    assert result["series_available"] and result["series_has_gaps"] and len(result["series"]) == 3
    assert result["series"][0]["energy_kwh"] == 0.5
    assert result["series_coverage"] == "provider_intervals_only" and not result["series_zero_filled"]
    assert len(calls) == 1


@pytest.mark.parametrize("change", ["wrong_entry", "wrong_platform", "wrong_unique_id", "disabled", "duplicate"])
async def test_native_discovery_cannot_bind_other_or_disabled_entities(change):
    overview, hass, rows, _, calls, _ = overview_hass()
    if change == "duplicate":
        rows.append(rows[0])
    else:
        key, value = {
            "wrong_entry": ("config_entry_id", "another-entry"),
            "wrong_platform": ("platform", "other_integration"),
            "wrong_unique_id": ("unique_id", f"{ENTRY}_energy_production_today_remaining"),
            "disabled": ("disabled_by", "user"),
        }[change]
        setattr(rows[0], key, value)
    result = await overview(hass, {"provider": "forecast_solar", "entry_id": ENTRY}, NOW)
    assert not result["available"] and result["today_kwh"] is None and not calls


@pytest.mark.parametrize("value,unit,age", [
    ("unknown", "kWh", 60), ("unavailable", "kWh", 60), ("NaN", "kWh", 60),
    ("-1", "kWh", 60), ("5", "W", 60), ("5", "kWh", 21601), ("5", "kWh", -6),
])
async def test_bad_or_stale_daily_cache_is_not_zero_or_a_fresh_forecast(value, unit, age):
    overview, hass, _, _, calls, _ = overview_hass(today=value, today_unit=unit, age=age)
    result = await overview(hass, {"provider": "forecast_solar", "entry_id": ENTRY}, NOW)
    assert not result["available"] and result["today_kwh"] is None and result["source_updated_at"] is None
    assert not calls


async def test_last_updated_fallback_and_mwh_conversion():
    overview, hass, _, states, _, _ = overview_hass(today="0.01", today_unit="MWh")
    for state in states.values():
        state.last_reported = None
        state.last_updated = NOW-timedelta(minutes=3)
    result = await overview(hass, {"provider": "forecast_solar", "entry_id": ENTRY}, NOW)
    assert result["available"] and result["today_kwh"] == 10
    assert result["source_updated_at"] == (NOW-timedelta(minutes=3)).isoformat()


async def test_hourly_service_failure_preserves_valid_independent_daily_totals():
    overview, hass, _, _, _, series = overview_hass()
    series["error"] = ValueError("PRIVATE PROVIDER RESPONSE")
    result = await overview(hass, {"provider": "forecast_solar", "entry_id": ENTRY}, NOW)
    assert result["available"] and not result["series_available"] and result["series"] == []
    assert "PRIVATE" not in str(result)


@pytest.mark.parametrize("provider,entry", [("forecast_solar", "wrong-entry"), ("unknown_provider", ENTRY), ("none", ENTRY)])
async def test_unselected_or_unsupported_source_is_explicitly_unavailable(provider, entry):
    overview, hass, _, _, calls, _ = overview_hass()
    result = await overview(hass, {"provider": provider, "entry_id": entry}, NOW)
    assert not result["available"] and result["today_kwh"] is None and not calls
