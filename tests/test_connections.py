from datetime import datetime, timedelta, timezone
from itertools import product

from custom_components.sigen_hybrid.core.connections import (
    capabilities,
    connection_states,
    enabled_connections,
    select_reading,
)

NOW = datetime(2026, 10, 28, tzinfo=timezone.utc)


def sources():
    return {
        k: {"observed_at": NOW.isoformat(), "values": {"pv_kw": v}}
        for k, v in zip(("modbus", "cloud"), (0, 2))
    }


def test_all_three_connection_combinations_are_independent():
    for flags in product((False, True), repeat=2):
        if not any(flags):
            continue
        expected = dict(zip(("modbus", "cloud"), flags))
        enabled = enabled_connections(
            {"host": "synthetic"}, {"cloud": {"saved": True}, "api": {"saved": True}, "connections": expected}
        )
        assert enabled == expected
        status = connection_states(enabled, dict.fromkeys(expected, True), sources(), {}, NOW)
        reading = select_reading("pv_kw", sources(), status, NOW)
        assert reading.source == next(k for k in expected if expected[k])


def test_local_zero_survives_total_internet_failure():
    states = connection_states(
        dict.fromkeys(sources(), True),
        dict.fromkeys(sources(), True),
        sources(),
        {"cloud": "offline", "api": "offline"},
        NOW,
    )
    assert select_reading("pv_kw", sources(), states, NOW).value == 0
    assert states["modbus"]["status"] == "connected"
    assert states["cloud"]["status"] == "disconnected"


def test_failed_local_falls_back_per_field_without_mutating_control_snapshot():
    data = sources()
    data["modbus"]["values"]["soc"] = 60
    states = connection_states(dict.fromkeys(data, True), dict.fromkeys(data, True), data, {"modbus": "offline"}, NOW)
    assert select_reading("pv_kw", data, states, NOW).source == "cloud"
    assert select_reading("soc", data, states, NOW) is None
    assert data["modbus"]["values"]["soc"] == 60
    states["cloud"]["status"] = "disconnected"
    assert select_reading("pv_kw", data, states, NOW) is None


def test_stale_naive_future_and_missing_values_never_become_zero():
    for stamp in [
        (NOW - timedelta(hours=1)).isoformat(),
        (NOW + timedelta(minutes=1)).isoformat(),
        "2026-10-28T00:00:00",
        None,
    ]:
        data = sources()
        for source in data.values():
            source["observed_at"] = stamp
        states = connection_states(dict.fromkeys(data, True), dict.fromkeys(data, True), data, {}, NOW)
        assert select_reading("pv_kw", data, states, NOW) is None


def test_modbus_only_never_advertises_app_mode_or_charger_switches():
    state = {"modbus": {"enabled": True, "status": "connected"}}
    result = capabilities(state)
    assert result["manual_control"]["supported"]
    assert not result["manual_control"]["available"]
    assert not result["native_mode"]["supported"]
    assert not result["grid_switch"]["supported"]
    state["modbus"]["status"] = "disconnected"
    offline = capabilities(state)
    assert offline["manual_control"]["supported"] and not offline["manual_control"]["available"]


def test_disabled_credentials_are_retained_but_never_selected():
    options = {
        "cloud": {"username": "synthetic"},
        "api": {"app_key": "synthetic"},
        "connections": {"cloud": False, "api": False},
    }
    assert not any(enabled_connections({"cloud_only": True}, options).values())
    assert options["cloud"]["username"] == "synthetic"
    assert "api" not in enabled_connections({"cloud_only": True}, options)
