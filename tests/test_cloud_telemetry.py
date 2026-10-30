import pytest

from custom_components.sigen_hybrid.core.telemetry import cloud_measurements, flow_schema


def test_cloud_readings_use_documented_units_and_preserve_signed_power():
    actual = cloud_measurements(
        {"pvPower": "2.5", "thirdPvPower": .5, "loadPower": 1.5, "buySellPower": -1.2, "batteryPower": .3, "batterySoc": "75"},
        "36.16",
    )
    assert actual == {"pv_kw": 3, "home_kw": 1.5, "grid_kw": 1.2, "battery_kw": .3, "soc": 75, "capacity_kwh": 36.16, "grid_status": None, "solar_today": None}


@pytest.mark.parametrize("bad", [None, True, "", "unavailable", "NaN", "inf", {}, []])
def test_missing_and_invalid_cloud_values_are_never_zero(bad):
    result = cloud_measurements({"pvPower": bad, "batterySoc": bad, "loadPower": bad})
    assert result["pv_kw"] is None and result["soc"] is None and result["home_kw"] is None
    assert result["grid_kw"] is None


def test_zero_is_a_valid_reading_and_soc_and_capacity_ranges_are_checked():
    result = cloud_measurements({"pvPower": 0, "batterySoc": 101, "batteryPower": 0}, 0)
    assert result["pv_kw"] == result["battery_kw"] == 0
    assert result["soc"] is None and result["capacity_kwh"] is None


def test_schema_diagnostics_omit_values_and_nonfield_identifiers():
    result = flow_schema({"pvPower": "PRIVATE", "ownerName": "PRIVATE NAME", "123456789": "PRIVATE"})
    assert result == {"pvPower": "str", "ownerName": "str"}
    assert "PRIVATE" not in str(result)
