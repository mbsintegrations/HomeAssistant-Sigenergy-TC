from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from custom_components.sigen_hybrid.core.models import SafetyLimits, Snapshot
from custom_components.sigen_hybrid.core.planner import Forecast, charging_plan
from custom_components.sigen_hybrid.core.tariffs import TariffPlan, TariffWindow, minute


def tariff():
    return TariffPlan(
        "Europe/Dublin",
        "EUR",
        Decimal("0.30"),
        Decimal("0.18"),
        (TariffWindow(minute("02:00"), minute("05:00"), Decimal("0.09")),),
    )


def test_import_export_prices_independent_and_major_units_required():
    when = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    assert tariff().rate_at(when) == Decimal("0.09")
    assert tariff().rate_at(when, "export") == Decimal("0.18")
    with pytest.raises(ValueError, match="major_currency"):
        TariffPlan.from_dict({"unit": "cent", "default_import": 9})


def test_overnight_weekday_and_month_use_window_start_date():
    window = TariffWindow(minute("22:00"), minute("06:00"), Decimal("0.1"), weekdays=(0,), months=(10,))
    assert window.contains(datetime(2026, 10, 27, 2, tzinfo=timezone.utc))  # Tuesday, Monday's window
    assert not window.contains(datetime(2026, 10, 28, 2, tzinfo=timezone.utc))


def test_dst_repeated_hour_uses_local_tariff_for_both_utc_instants():
    plan = TariffPlan("Europe/Dublin", "EUR", Decimal("0.3"), Decimal("0"), (TariffWindow(60, 120, Decimal("-0.05")),))
    assert plan.rate_at(datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc)) == Decimal("-0.05")
    assert plan.rate_at(datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc)) == Decimal("-0.05")


def test_overlapping_windows_rejected():
    plan = TariffPlan(
        "UTC",
        "EUR",
        Decimal("0.3"),
        Decimal("0"),
        (TariffWindow(0, 120, Decimal("0.1")), TariffWindow(60, 180, Decimal("0.2"))),
    )
    with pytest.raises(ValueError, match="Overlapping"):
        plan.rate_at(datetime(2026, 10, 26, 1, tzinfo=timezone.utc))


def test_low_cost_plan_uses_cheap_window_and_never_exports():
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    snapshot = Snapshot(now, 20, 0, 1, 1, 0, 20, 5, 5)
    forecast = Forecast(now, 0, 10, uncertainty=0)
    result = charging_plan(snapshot, SafetyLimits(max_charge_kw=5), tariff(), forecast, now)
    assert result["advisory_only"] and not result["export_permitted"]
    assert result["unserved_kwh"] == 0
    assert all(2 <= datetime.fromisoformat(s["start"]).hour < 5 for s in result["slots"])
    assert result["estimated_charge_cost"] == pytest.approx(1, abs=0.001)


def test_short_cheap_window_cannot_hide_remaining_energy_cost():
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    snapshot = Snapshot(now, 20, 0, 1, 1, 0, 20, 5, 5)
    result = charging_plan(snapshot, SafetyLimits(max_charge_kw=3), tariff(), Forecast(now, 0, 10, uncertainty=0), now)
    assert any(float(s["rate"]) == 0.3 for s in result["slots"])
    assert result["estimated_charge_cost"] > 1


def test_stale_forecast_does_not_turn_into_zero_solar():
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    with pytest.raises(Exception, match="Forecast is stale"):
        Forecast(now - timedelta(hours=7), 10, 10).validate(now)


@pytest.mark.parametrize("value", ["24:30", "25:00", "-1:30", "bad"])
def test_invalid_tariff_time(value):
    with pytest.raises(ValueError):
        minute(value)
