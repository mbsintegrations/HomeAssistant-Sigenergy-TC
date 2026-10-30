from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.energy import DailyEnergyCounters

NOW = datetime(2026, 10, 29, 14, tzinfo=timezone.utc)


def test_migration_retains_today_then_uses_only_native_cumulative_deltas():
    tracker = DailyEnergyCounters("Europe/Dublin")
    tracker.seed("solar_today", 140.20, .01, NOW - timedelta(hours=6), 147.83, NOW)
    assert tracker.update({"solar_lifetime": 147.83}, NOW)["solar_today"] == 7.64
    assert tracker.update({"solar_lifetime": 148}, NOW + timedelta(minutes=10))["solar_today"] == 7.81
    restored = DailyEnergyCounters("Europe/Dublin")
    restored.restore(tracker.dump())
    assert restored.update({"solar_lifetime": 148.1}, NOW + timedelta(minutes=11))["solar_today"] == 7.91


def test_unknown_first_day_is_not_zero_and_counter_reset_is_not_negative_energy():
    tracker = DailyEnergyCounters()
    assert "solar_today" not in tracker.update({"solar_lifetime": 100}, NOW)
    tracker.seed("solar_today", 100, 10, NOW, 100, NOW)
    assert "solar_today" not in tracker.update({"solar_lifetime": 0}, NOW + timedelta(minutes=1))
    assert tracker.update({"solar_lifetime": 101}, NOW + timedelta(minutes=2))["solar_today"] == 11


def test_midnight_in_plant_timezone_and_overnight_outage():
    tracker = DailyEnergyCounters("Europe/Dublin")
    before = datetime(2026, 7, 1, 22, 59, 30, tzinfo=timezone.utc)
    tracker.update({"grid_import_lifetime": 100}, before)
    assert tracker.update({"grid_import_lifetime": 100.02}, before + timedelta(seconds=60))["grid_import_today"] == .02
    assert "grid_import_today" not in tracker.update({"grid_import_lifetime": 110}, before + timedelta(days=1, hours=5))


def test_seed_rejects_wrong_day_invalid_values_and_overwrite():
    for args in ((100, 10, NOW - timedelta(days=1), 101), (100, 101, NOW, 102), (100, 10, NOW, 99), (float("inf"), 1, NOW, 101)):
        with pytest.raises(ValueError):
            DailyEnergyCounters().seed("solar_today", *args, NOW)
    tracker = DailyEnergyCounters()
    tracker.seed("solar_today", 100, 10, NOW, 100, NOW)
    with pytest.raises(ValueError):
        tracker.seed("solar_today", 100, 9, NOW, 100, NOW)


def test_restore_rejects_wrong_timezone_and_invalid_state():
    tracker = DailyEnergyCounters("Europe/Dublin")
    tracker.restore({"timezone": "UTC", "records": {"solar_today": {"baseline": 1}}})
    assert tracker.records == {}
    tracker.restore({"timezone": "Europe/Dublin", "records": {"solar_today": {"baseline": -1, "last": 100, "date": "2026-10-29", "observed_at": NOW.isoformat()}}})
    assert tracker.records == {}
