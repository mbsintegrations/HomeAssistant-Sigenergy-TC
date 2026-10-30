"""Exercise the HA cached-service adapter without requiring a HA runtime."""

import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.forecasts import (
    PROVIDERS,
    energy_for_horizon,
    entity_points,
    forecast_solar_points,
    merge_points,
)

BASE = datetime(2026, 10, 27, tzinfo=timezone.utc)


def adapter():
    source = Path("custom_components/sigen_hybrid/forecast.py").read_text()
    tree = ast.parse(source)
    module = ast.Module(
        body=[node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))],
        type_ignores=[],
    )
    loaded = object()
    scope = {
        "timedelta": timedelta,
        "ConfigEntryState": SimpleNamespace(LOADED=loaded),
        "PROVIDERS": PROVIDERS,
        "energy_for_horizon": energy_for_horizon,
        "entity_points": entity_points,
        "forecast_solar_points": forecast_solar_points,
        "merge_points": merge_points,
        "utcnow": lambda: BASE,
    }
    exec(compile(module, "forecast.py", "exec"), scope)
    return scope["async_forecast"], loaded


def cached_service_hass(loaded, rows, calls):
    entry = SimpleNamespace(entry_id="synthetic-provider", state=loaded)

    async def call(domain, service, data, **kwargs):
        assert (domain, service) == ("forecast_solar", "get_forecast")
        assert kwargs == {"blocking": True, "return_response": True}
        assert data["config_entry"] == entry.entry_id and data["resolution"] == "hourly"
        calls.append(data)
        start = datetime.fromisoformat(data["start"])
        end = datetime.fromisoformat(data["end"])
        # Match the native cached action's inclusive-start/exclusive-end filter.
        return {"wh_period": {timestamp.isoformat(): wh for timestamp, wh in rows.items() if start <= timestamp < end}}

    return SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry] if domain == "forecast_solar" else []),
        services=SimpleNamespace(async_call=call),
    )


@pytest.mark.parametrize("minute,expected,points", [(0, 47, 24), (23, 48.15, 25)])
async def test_cached_hourly_forecast_includes_partial_hour_and_clips_true_24_hours(minute, expected, points):
    forecast, loaded = adapter()
    rows = {BASE + timedelta(hours=hour): 2000 for hour in range(25)}
    rows[BASE] = 1000
    rows[BASE + timedelta(hours=24)] = 4000
    calls = []
    start = BASE + timedelta(minutes=minute)
    result = await forecast(
        cached_service_hass(loaded, rows, calls),
        {"provider": "forecast_solar", "entry_id": "synthetic-provider"},
        start,
    )
    assert result["available"] is True
    assert result["solar_24h_kwh"] == expected and result["points"] == points
    assert result["updated_at"] == start.isoformat() and result["horizon_hours"] == 24
    assert len(calls) == 1
    assert calls[0]["start"] == BASE.isoformat()
    assert calls[0]["end"] == (start + timedelta(hours=24)).isoformat()


async def test_partial_hour_fix_does_not_fill_missing_provider_intervals_with_zero():
    forecast, loaded = adapter()
    rows = {BASE + timedelta(hours=hour): 2000 for hour in range(25) if hour != 3}
    result = await forecast(
        cached_service_hass(loaded, rows, []),
        {"provider": "forecast_solar", "entry_id": "synthetic-provider"},
        BASE + timedelta(minutes=23),
    )
    assert result["available"] is False
    assert "solar_24h_kwh" not in result
