"""Cloud monitoring must never become a local-control Snapshot."""

import ast
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.models import SafetyLimits, Snapshot
from custom_components.sigen_hybrid.core.power import manual_power_metadata

NOW = datetime(2026, 10, 27, tzinfo=timezone.utc)


class CoordinatorEntityDouble:
    def __init__(self, coordinator):
        self.coordinator = coordinator


def sensor(key, *, local=None, cloud_error=None, age=0):
    tree = ast.parse(Path("custom_components/sigen_hybrid/sensor.py").read_text())
    module = ast.Module(body=[n for n in tree.body if isinstance(n, (ast.ClassDef, ast.Assign))], type_ignores=[])
    scope = {
        "__name__": "custom_components.sigen_hybrid.sensor",
        "__package__": "custom_components.sigen_hybrid",
        "dataclass": dataclass,
        "datetime": datetime,
        "utcnow": lambda: NOW,
        "manual_power_metadata": manual_power_metadata,
        "DOMAIN": "sigen_hybrid",
        "SensorDeviceClass": SimpleNamespace(
            BATTERY="battery", POWER="power", ENERGY_STORAGE="energy_storage", ENERGY="energy"
        ),
        "SensorStateClass": SimpleNamespace(MEASUREMENT="measurement", TOTAL_INCREASING="total_increasing"),
        "EntityCategory": SimpleNamespace(DIAGNOSTIC="diagnostic"),
        "CoordinatorEntity": CoordinatorEntityDouble,
        "SensorEntity": object,
        "DeviceInfo": lambda **kwargs: kwargs,
    }
    exec(compile(module, "sensor.py", "exec"), scope)
    entry = SimpleNamespace(
        data={"cloud_only": True}, options={}, unique_id="synthetic", entry_id="synthetic", title="Synthetic"
    )
    runtime = SimpleNamespace(
        entry=entry,
        data=local,
        cloud_error=cloud_error,
        cloud_data={
            "updated_at": (NOW - timedelta(seconds=age)).isoformat(),
            "telemetry_available": True,
            "telemetry": {"pv_kw": 1.2},
        },
        forecast_data={"available": True, "today_kwh": 10, "tomorrow_kwh": 8, "source_updated_at": NOW.isoformat()},
        controller=Controller(SafetyLimits()),
    )
    if key.startswith("module:"):
        desc = next(d for d in scope["MODULE_DESCRIPTIONS"] if d.key == key.split(":", 1)[1])
        runtime.cloud_data["battery_modules"] = [
            {
                "serial": "BAT1",
                "measurements": {
                    desc.key: {
                        "value": -0.618,
                        "unit": "kW",
                        "observed_at": None,
                        "retrieved_at": (NOW - timedelta(seconds=age)).isoformat(),
                        "timestamp_basis": "cloud_retrieval",
                    }
                },
            }
        ]
        return scope["BatteryModuleSensor"](runtime, entry, "BAT1", desc), runtime
    desc = next(d for d in scope["DESCRIPTIONS"] if d.key == key)
    return scope["SigenSensor"](runtime, entry, desc), runtime


def test_cloud_only_reading_is_explicit_and_does_not_create_control_snapshot():
    entity, runtime = sensor("pv_kw")
    assert entity.native_value == 1.2
    assert runtime.data is None
    assert entity.extra_state_attributes["data_source"] == "sigenergy_cloud"
    assert entity.extra_state_attributes["timestamp_basis"] == "cloud_retrieval"


def test_failed_stale_or_future_cloud_cache_is_not_exposed_as_current():
    for kwargs in [{"cloud_error": "unavailable"}, {"age": 1801}, {"age": -6}]:
        entity, _ = sensor("pv_kw", **kwargs)
        assert entity.native_value is None


def test_local_measurement_stays_authoritative_when_cloud_fails():
    entity, _ = sensor("pv_kw", local=SimpleNamespace(pv_kw=8), cloud_error="unavailable")
    assert entity.native_value == 8


def test_forecast_is_independent_of_cloud_and_keeps_source_observation_time():
    entity, _ = sensor("forecast_today", cloud_error="unavailable")
    assert entity.native_value == 10
    assert entity._attr_state_class is None
    assert entity.extra_state_attributes["observed_at"] == NOW.isoformat()


def test_control_power_metadata_is_cloud_read_only_without_default_owner_or_device_caps():
    entity, runtime = sensor("control_status")
    runtime.cloud_data["telemetry_available"] = False
    runtime.cloud_data["manual_control_power"] = {
        "charge": {"app_default_kw": 5.5},
        "discharge": {"app_unlimited": True},
    }
    attrs = entity.extra_state_attributes
    assert attrs["manual_control_power"] == {"charge": {"app_default_kw": 5.5}, "discharge": {"app_unlimited": True}}
    assert attrs["live_writes_locked"] is True and attrs["export_permitted"] is False
    assert runtime.data is None and runtime.controller.limits.max_charge_kw == 3
    assert attrs["max_duration_minutes"] == 1440


def test_control_power_metadata_hides_stale_or_failed_app_caps():
    for kwargs in ({"age": 1801}, {"cloud_error": "unavailable"}):
        entity, runtime = sensor("control_status", **kwargs)
        runtime.cloud_data["manual_control_power"] = {"charge": {"app_default_kw": 5.5}}
        assert entity.extra_state_attributes["manual_control_power"] == {}


def test_control_power_metadata_uses_only_explicit_owner_options_and_valid_local_limits():
    local = Snapshot(NOW, 50, 1, 1, 0, 0, 20, 12, 10)
    entity, runtime = sensor("control_status", local=local)
    runtime.entry.data = {"demo": False}
    runtime.entry.options["safety"] = {"max_charge_kw": 4}
    assert entity.extra_state_attributes["manual_control_power"] == {
        "charge": {"device_max_kw": 12, "user_max_kw": 4},
        "discharge": {"device_max_kw": 10},
    }
    runtime.entry.data["demo"] = True
    assert entity.extra_state_attributes["manual_control_power"] == {"charge": {"user_max_kw": 4}}


def test_control_status_exposes_the_effective_explicit_lower_duration_limit():
    entity, runtime = sensor("control_status")
    runtime.controller.limits = SafetyLimits(max_duration_minutes=60)
    assert entity.extra_state_attributes["max_duration_minutes"] == 60


def test_dashboard_display_preference_is_exposed_without_unrelated_options():
    entity, runtime = sensor("control_status")
    runtime.entry.options["dashboard"] = {
        "preset": "overview",
        "main_display": "photo",
        "appearance": "auto",
        "charts": ["power"],
        "unrelated_private_value": "never-expose",
    }
    assert entity.extra_state_attributes["dashboard"] == {
        "preset": "overview",
        "main_display": "photo",
        "appearance": "auto",
        "charts": ["power"],
    }
    assert entity.extra_state_attributes["live_writes_locked"] is True


def test_module_sensor_preserves_own_signed_measurement_and_timestamp_provenance():
    entity, _ = sensor("module:power_kw")
    assert entity.native_value == -0.618
    assert entity.extra_state_attributes["module_serial"] == "BAT1"
    assert entity.extra_state_attributes["timestamp_basis"] == "cloud_retrieval"
    assert entity.extra_state_attributes["observed_at"] is None


def test_module_sensor_hides_stale_failed_or_wrong_serial_instead_of_aggregate_fallback():
    for kwargs in ({"age": 1801}, {"age": -6}, {"cloud_error": "unavailable"}):
        entity, _ = sensor("module:power_kw", **kwargs)
        assert not entity.available and entity.native_value is None
    entity, runtime = sensor("module:power_kw")
    runtime.cloud_data["battery_modules"][0]["serial"] = "BAT2"
    assert not entity.available and entity.native_value is None
    entity, runtime = sensor("module:power_kw")
    runtime.cloud_data["battery_modules"][0]["measurements"]["power_kw"]["observed_at"] = (
        NOW - timedelta(hours=1)
    ).isoformat()
    assert not entity.available


def test_cloud_status_exports_bounded_module_schema_diagnostics_without_recording_them():
    entity, runtime = sensor("cloud_status")
    runtime.cloud_data["module_read_diagnostics"] = {"inventory_count": 4}
    assert entity.extra_state_attributes["module_read_diagnostics"] == {"inventory_count": 4}
    assert "module_read_diagnostics" in entity._unrecorded_attributes
