"""Manual power defaults must remain distinct from device and explicit owner caps."""

from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.models import Snapshot
from custom_components.sigen_hybrid.core.power import app_power_limits, finite_power_kw, manual_power_metadata

NOW = datetime(2026, 10, 27, tzinfo=timezone.utc)


def snapshot(**changes):
    data = dict(observed_at=NOW, soc=50, pv_kw=1, home_kw=1, grid_kw=0, battery_kw=0,
                capacity_kwh=20, max_charge_kw=12, max_discharge_kw=10)
    return Snapshot(**{**data, **changes})


def metadata(*, app=None, age=0, error=None, local=None, safety=None, demo=False):
    return manual_power_metadata(
        cloud_data={"updated_at": (NOW-timedelta(seconds=age)).isoformat(), "manual_control_power": app or {}},
        cloud_error=error, snapshot=local, user_safety=safety or {}, demo=demo, now=NOW,
    )


def test_app_power_known_numeric_strings_are_kw_without_alias_or_live_power_guessing():
    assert app_power_limits({
        "batteryMaxChargingPower": " 5.5 ", "batteryMaxDischargingPower": "4.25",
        "batteryPower": 99, "chargePower": 50,
    }) == {"charge": {"app_default_kw": 5.5}, "discharge": {"app_default_kw": 4.25}}
    assert app_power_limits({"batteryPower": 5.5, "batterySoc": 50}) == {}


@pytest.mark.parametrize("value", ["4294967.295", 4294967.295, "4294967.295000"])
def test_exact_unlimited_sentinel_is_not_a_device_power_rating(value):
    result = app_power_limits({"batteryMaxChargingPower": value, "batteryMaxDischargingPower": "8"})
    assert result == {"charge": {"app_unlimited": True}, "discharge": {"app_default_kw": 8}}
    assert finite_power_kw(value) is None
    assert metadata(app=result)["charge"] == {"app_unlimited": True}


@pytest.mark.parametrize("value", [True, False, None, "", "nan", "inf", "-inf", float("nan"), float("inf"),
                                   0, "0", -1, "-3", "5 kW", {}, [], "4294967.2951", 5000000])
def test_malformed_or_non_cap_app_values_remain_unknown(value):
    assert app_power_limits({"batteryMaxChargingPower": value}) == {}
    assert finite_power_kw(value) is None


def test_independent_finite_caps_merge_without_inventing_defaults():
    result = metadata(app={"charge": {"app_default_kw": 5.5}}, local=snapshot(), safety={"max_charge_kw": "4"})
    assert result == {
        "charge": {"app_default_kw": 5.5, "device_max_kw": 12, "user_max_kw": 4},
        "discharge": {"device_max_kw": 10},
    }
    assert metadata() == {}
    assert "user_max_kw" not in metadata(local=snapshot())["charge"]


@pytest.mark.parametrize("age,error", [(1801, None), (-6, None), (0, "cloud unavailable")])
def test_stale_future_or_failed_cloud_limits_are_hidden_independently(age, error):
    result = metadata(app={"charge": {"app_default_kw": 5.5}}, age=age, error=error, safety={"max_charge_kw": 4})
    assert result == {"charge": {"user_max_kw": 4}}


@pytest.mark.parametrize("local,demo", [
    (snapshot(observed_at=NOW-timedelta(seconds=31)), False),
    (snapshot(observed_at=NOW+timedelta(seconds=6)), False),
    (snapshot(soc=float("nan")), False),
    (snapshot(source="cloud"), False),
    (snapshot(source="demo"), False),
    (snapshot(), True),
])
def test_only_fresh_validated_local_non_demo_snapshot_can_supply_device_ratings(local, demo):
    assert metadata(local=local, demo=demo) == {}


def test_invalid_explicit_safety_or_conflicting_app_metadata_does_not_become_a_limit():
    assert metadata(
        app={"charge": {"app_default_kw": 5, "app_unlimited": True}, "discharge": {"app_unlimited": "true"}},
        safety={"max_charge_kw": 0, "max_discharge_kw": "4294967.295"},
    ) == {}
