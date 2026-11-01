"""Restart, source identity, clock and permission isolation regressions."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from custom_components.sigen_hybrid.core.read_cache import cache_payload, plant_identity, restore_cache

NOW = datetime(2026, 11, 1, 8, tzinfo=timezone.utc)


def test_restart_preserves_only_same_plant_observations_and_never_permissions():
    identity = plant_identity({"cloud": {"region": "eu", "station_id": "synthetic"}})
    cloud = {"device_inventory": [{"type": "ac", "id": "AC1", "installed": True}],
             "mode": "Maximum Self-Powered", "mode_observed_at": NOW.isoformat(),
             "owner_controls": {"hasAcCharger": True}, "capabilities": {"native_mode": True}, "token": "not-for-storage"}
    daily = {"values": {"solar_today": 7.64, "home_today": 21.11, "pv_kw": 2}, "observed_at": NOW.isoformat()}
    saved = cache_payload(identity, cloud, daily, NOW)
    restored, energy = restore_cache(saved, identity, NOW + timedelta(seconds=60))
    assert restored["device_inventory"] == cloud["device_inventory"]
    assert restored["mode"] == "Maximum Self-Powered"
    assert energy["values"] == {"solar_today": 7.64, "home_today": 21.11}
    assert not {"owner_controls", "capabilities", "token", "telemetry"} & restored.keys()
    assert "not-for-storage" not in str(saved)
    assert restore_cache(saved, "different-plant", NOW) == ({}, {})


def test_restart_cache_expires_readings_but_keeps_discovered_device_presence():
    saved = cache_payload("plant", {"device_inventory": [{"type": "dc", "installed": True}],
                                    "mode": "AI", "mode_observed_at": NOW.isoformat()},
                          {"values": {"solar_today": 0}, "observed_at": NOW.isoformat()}, NOW)
    cloud, daily = restore_cache(saved, "plant", NOW + timedelta(minutes=31))
    assert cloud == {"device_inventory": [{"type": "dc", "installed": True}]}
    assert daily == {}


def test_daily_history_cannot_carry_yesterday_across_local_midnight():
    zone = ZoneInfo("Europe/Dublin")
    before = datetime(2026, 7, 1, 23, 58, tzinfo=zone)
    saved = cache_payload("plant", {}, {"values": {"solar_today": 35}, "observed_at": before.isoformat()}, before)
    assert restore_cache(saved, "plant", before + timedelta(minutes=4))[1] == {}


def test_invalid_daily_observations_cannot_become_readings():
    for stamp in (None, "bad", NOW.replace(tzinfo=None).isoformat(), (NOW + timedelta(minutes=1)).isoformat()):
        assert cache_payload("plant", {}, {"values": {"solar_today": 12}, "observed_at": stamp}, NOW)["daily"] == {}
