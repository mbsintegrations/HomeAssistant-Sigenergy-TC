"""Live releases must not inherit screenshot fixtures or stale review bindings."""

import importlib.util
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("live_profile_audit", Path("tools/validate_live_profile.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
validate = MODULE.validate_live_profile


def test_approved_test_optimizers_cannot_silently_become_live_hardware():
    config = {"optimizers": [{"power": f"sensor.sigen_review_string_1_panel_{i:02}"} for i in range(1, 12)]}
    assert len(validate(config, {})) == 11


def test_screenshot_battery_and_demo_are_rejected():
    findings = validate({"demo": True, "screenshot_preview": {"enabled": True, "tablet_battery_percent": 87}}, {})
    assert len(findings) == 2


def test_unknown_fixture_names_are_detected_by_source_metadata():
    assert validate({"entities": {"solar_power": "sensor.custom_power"}}, {
        "sensor.custom_power": {"attributes": {"sample_data": True}},
    })


def test_offline_real_hardware_remains_valid_and_is_not_removed():
    config = {"devices": [{"entities": {"power": "sensor.real_inverter"}}]}
    assert validate(config, {"sensor.real_inverter": {"state": "unavailable", "attributes": {"data_source": "modbus"}}}) == []
    assert validate(config, {}, ["sensor.real_inverter"]) == []
    assert config["devices"][0]["entities"]["power"] == "sensor.real_inverter"


def test_live_profile_rejects_missing_bindings_and_inline_recordings():
    findings = validate({"entities": {"soc": "sensor.missing"}, "recorded_history": {"soc": [50]}}, {})
    assert len(findings) == 2
