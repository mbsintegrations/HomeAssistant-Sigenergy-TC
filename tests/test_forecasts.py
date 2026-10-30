from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.forecasts import (
    ForecastPoint,
    energy_for_horizon,
    entity_points,
    forecast_solar_points,
    merge_points,
)

START = datetime(2026, 10, 26, 10, tzinfo=timezone.utc)


def test_solcast_power_is_integrated_over_half_hour_not_treated_as_kwh():
    points = entity_points("solcast", {"detailedForecast": [{"period_start": START.isoformat(), "pv_estimate": 4}]})
    assert energy_for_horizon(points, START, START + timedelta(minutes=30)) == 2


def test_volcast_hourly_energy_is_authoritative():
    points = entity_points("volcast", {"detailedHourly": [{"period_start": START, "power_kw": 9, "energy_kwh": 3}]})
    assert energy_for_horizon(points, START, START + timedelta(hours=1)) == 3


def test_volcast_five_minute_wh_conversion():
    points = entity_points("volcast", {"detailedForecast": [{"period_start": START, "energy_wh": 250}]})
    assert energy_for_horizon(points, START, START + timedelta(minutes=5)) == 0.25


def test_forecast_solar_hourly_wh_conversion_and_partial_interval():
    points = forecast_solar_points({"wh_period": {START.isoformat(): 2000}})
    assert energy_for_horizon(points, START + timedelta(minutes=30), START + timedelta(hours=1)) == 1


def test_missing_horizon_is_unknown_not_zero():
    point = ForecastPoint(START, START + timedelta(hours=1), 3)
    with pytest.raises(ValueError, match="cover"):
        energy_for_horizon([point], START, START + timedelta(hours=2))


def test_duplicate_and_overlapping_roof_series_are_not_double_counted():
    a = ForecastPoint(START, START + timedelta(hours=1), 3)
    assert len(merge_points([a, a])) == 1
    with pytest.raises(ValueError, match="Conflicting"):
        merge_points([a, ForecastPoint(START, START + timedelta(hours=1), 4)])
    with pytest.raises(ValueError, match="Overlapping"):
        merge_points([a, ForecastPoint(START + timedelta(minutes=30), START + timedelta(hours=2), 4)])


@pytest.mark.parametrize(
    "provider,attrs",
    [
        ("solcast", {}),
        ("volcast", {}),
        ("solcast", {"detailedForecast": [{"period_start": "2026-10-26T10:00:00", "pv_estimate": 3}]}),
    ],
)
def test_missing_or_naive_provider_data_rejected(provider, attrs):
    with pytest.raises(ValueError):
        entity_points(provider, attrs)
