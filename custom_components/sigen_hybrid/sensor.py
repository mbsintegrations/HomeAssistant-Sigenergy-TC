"""Local measurements and honest command/permission status."""

from dataclasses import dataclass
from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.helpers.entity import DeviceInfo, EntityCategory
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .core.models import utcnow
from .core.power import manual_power_metadata


@dataclass(frozen=True)
class Description:
    key: str
    name: str
    unit: str | None = None
    device_class: str | None = None


DESCRIPTIONS = (
    Description("soc", "Battery state of charge", "%", SensorDeviceClass.BATTERY),
    Description("pv_kw", "Solar power", "kW", SensorDeviceClass.POWER),
    Description("home_kw", "Load power", "kW", SensorDeviceClass.POWER),
    Description("grid_kw", "Grid power", "kW", SensorDeviceClass.POWER),
    Description("battery_kw", "Battery power", "kW", SensorDeviceClass.POWER),
    Description("capacity_kwh", "Battery capacity", "kWh", SensorDeviceClass.ENERGY_STORAGE),
    Description("native_mode", "Native mode code"),
    Description("grid_status", "Grid and system status"),
    Description("control_status", "Control status"),
    Description("modbus_status", "Modbus status"),
    Description("cloud_status", "Cloud status"),
    Description("cloud_mode", "Cloud operating mode"),
    Description("forecast_status", "Forecast provider"),
    Description("forecast_today", "Solar forecast today", "kWh", SensorDeviceClass.ENERGY),
    Description("forecast_tomorrow", "Solar forecast tomorrow", "kWh", SensorDeviceClass.ENERGY),
    Description("solar_today", "Solar energy today", "kWh", SensorDeviceClass.ENERGY),
    *(
        Description(key, name, "kWh", SensorDeviceClass.ENERGY)
        for key, name in (
            ("home_today", "Home energy today"),
            ("battery_charge_today", "Battery charged today"),
            ("battery_discharge_today", "Battery discharged today"),
            ("grid_import_today", "Grid imported today"),
            ("grid_export_today", "Grid exported today"),
            ("ac_today", "AC charged today"),
            ("dc_today", "DC charged today"),
            ("dc_discharge_today", "DC discharged today"),
            ("solar_lifetime", "Solar total energy"),
            ("home_lifetime", "Home total energy"),
            ("battery_charge_lifetime", "Battery total charged energy"),
            ("battery_discharge_lifetime", "Battery total discharged energy"),
            ("grid_import_lifetime", "Grid total imported energy"),
            ("grid_export_lifetime", "Grid total exported energy"),
            ("ac_plant_lifetime", "AC total charged energy"),
            ("dc_plant_lifetime", "DC total charged energy"),
            ("dc_discharge_lifetime", "DC total discharged energy"),
        )
    ),
)


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([SigenSensor(entry.runtime_data, entry, description) for description in DESCRIPTIONS])
    known_modules = set()

    def add_modules():
        additions = []
        for module in entry.runtime_data.cloud_data.get("battery_modules", []):
            serial = module.get("serial")
            if not isinstance(serial, str) or serial in known_modules:
                continue
            known_modules.add(serial)
            additions.extend(
                BatteryModuleSensor(entry.runtime_data, entry, serial, description)
                for description in MODULE_DESCRIPTIONS
            )
        if additions:
            async_add_entities(additions)

    entry.async_on_unload(entry.runtime_data.async_add_listener(add_modules))
    add_modules()


MODULE_DESCRIPTIONS = (
    Description("soc", "State of charge", "%", "battery"),
    Description("power_kw", "Power", "kW", "power"),
    Description("voltage_v", "Pack voltage", "V", "voltage"),
    Description("temperature_c", "Average cell temperature", "°C", "temperature"),
    Description("cell_voltage_v", "Average cell voltage", "V", "voltage"),
    Description("total_discharge_kwh", "Total discharge", "kWh", "energy"),
    Description("heating", "Heating status"),
)


class BatteryModuleSensor(CoordinatorEntity, SensorEntity):
    """Own module measurement only; aggregate stack data is never substituted."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, entry, serial, description):
        super().__init__(coordinator)
        self.serial, self.description = serial, description
        self._attr_unique_id = f"{entry.unique_id}_battery_{serial}_{description.key}"
        self._attr_name = description.name
        self._attr_native_unit_of_measurement = description.unit
        self._attr_device_class = description.device_class
        if description.unit:
            self._attr_state_class = "total_increasing" if description.key == "total_discharge_kwh" else "measurement"
        module = self._module
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.unique_id}_battery_{serial}")},
            via_device=(DOMAIN, entry.unique_id),
            name=f"Sigen battery {serial}",
            manufacturer="Sigenergy",
            model=module.get("model"),
            sw_version=module.get("firmware"),
            serial_number=serial,
        )

    @property
    def _module(self):
        return next(
            (
                item
                for item in self.coordinator.cloud_data.get("battery_modules", [])
                if item.get("serial") == self.serial
            ),
            {},
        )

    @property
    def _measurement(self):
        return self._module.get("measurements", {}).get(self.description.key, {})

    @property
    def available(self):
        if self.coordinator.cloud_error:
            return False
        measurement = self._measurement
        try:
            clock = measurement.get("observed_at") or measurement["retrieved_at"]
            return -5 <= (utcnow() - datetime.fromisoformat(clock)).total_seconds() <= 1800
        except KeyError, TypeError, ValueError:
            return False

    @property
    def native_value(self):
        return self._measurement.get("value") if self.available else None

    @property
    def extra_state_attributes(self):
        return {
            "data_source": "sigenergy_cloud_device",
            "module_serial": self.serial,
            "observed_at": self._measurement.get("observed_at"),
            "retrieved_at": self._measurement.get("retrieved_at"),
            "timestamp_basis": self._measurement.get("timestamp_basis"),
            "poll_interval_seconds": 900,
        }


class SigenSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _unrecorded_attributes = frozenset({"series", "battery_modules", "device_inventory", "module_read_diagnostics", "request_budget"})

    def __init__(self, coordinator, entry, description):
        super().__init__(coordinator)
        self.description = description
        self._attr_unique_id = f"{entry.unique_id}_{description.key}"
        self._attr_name = description.name
        self._attr_native_unit_of_measurement = description.unit
        self._attr_device_class = description.device_class
        if description.unit is not None:
            self._attr_state_class = (
                None
                if description.key in ("forecast_today", "forecast_tomorrow")
                else SensorStateClass.TOTAL_INCREASING
                if description.key.endswith(("_today", "_lifetime"))
                else SensorStateClass.MEASUREMENT
            )
        else:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id)},
            name=entry.title,
            manufacturer="Sigenergy",
            model="Sigenergy TC (Total Control)",
        )

    @property
    def available(self):
        key = self.description.key
        if key.endswith("_status") or key in ("cloud_mode", "native_mode", "grid_status"):
            return True
        if key in ("forecast_today", "forecast_tomorrow"):
            return bool(self.coordinator.forecast_data.get("available"))
        if hasattr(self.coordinator, "reading"):
            return self.coordinator.reading(key) is not None
        return self.native_value is not None

    @property
    def _cloud_measurements_ready(self):
        if self.coordinator.cloud_error or not self.coordinator.cloud_data.get("telemetry_available"):
            return False
        try:
            age = (utcnow() - datetime.fromisoformat(self.coordinator.cloud_data["updated_at"])).total_seconds()
            return -5 <= age <= 1800
        except KeyError, TypeError, ValueError:
            return False

    @property
    def native_value(self):
        key = self.description.key
        if key in ("forecast_today", "forecast_tomorrow"):
            forecast = self.coordinator.forecast_data
            return (
                forecast.get("today_kwh" if key == "forecast_today" else "tomorrow_kwh")
                if forecast.get("available")
                else None
            )
        if key == "grid_status":
            if hasattr(self.coordinator, "reading"):
                selected = self.coordinator.reading(key)
                return selected.value if selected else None
            data = self.coordinator.data
            if data is None and self.coordinator.entry.data.get("cloud_only") and self._cloud_measurements_ready:
                return self.coordinator.cloud_data.get("telemetry", {}).get("grid_status")
            return (
                None
                if data is None
                else ("Normal" if data.running else "Stopped") + (" | On Grid" if data.on_grid else " | Off Grid")
            )
        if key == "cloud_mode":
            return self.coordinator.cloud_data.get("mode") if not self.coordinator.cloud_error else None
        if key == "control_status":
            controls = getattr(self.coordinator, "controls", None)
            if controls is not None and controls.enabled:
                return controls.operation["phase"]
            result = self.coordinator.controller.last_result
            return (
                result.status if result else "demo" if self.coordinator.entry.data.get("demo") else "live_writes_locked"
            )
        if key == "cloud_status":
            if hasattr(self.coordinator, "connections"):
                return self.coordinator.connections["cloud"]["status"]
            return self.coordinator.cloud_error or (
                "connected"
                if self.coordinator.cloud_data
                else "not_configured"
                if self.coordinator.cloud is None
                else "waiting"
            )
        if key == "modbus_status":
            return (
                self.coordinator.connections["modbus"]["status"]
                if hasattr(self.coordinator, "connections")
                else "disabled"
            )
        if key == "forecast_status":
            return self.coordinator.forecast_data.get("provider") or self.coordinator.entry.options.get("forecast", {}).get("provider", "none")
        if hasattr(self.coordinator, "reading"):
            selected = self.coordinator.reading(key)
            return selected.value if selected else None
        if self.coordinator.data is not None:
            return getattr(self.coordinator.data, key, None)
        if self.coordinator.entry.data.get("cloud_only") and self._cloud_measurements_ready:
            return self.coordinator.cloud_data.get("telemetry", {}).get(key)
        return None

    @property
    def extra_state_attributes(self):
        observed = {"observed_at": self.coordinator.data.observed_at.isoformat()} if self.coordinator.data else {}
        if hasattr(self.coordinator, "reading"):
            selected = self.coordinator.reading(self.description.key)
            observed = (
                {
                    "observed_at": selected.observed_at,
                    "data_source": selected.source,
                    "timestamp_basis": "device_observation" if selected.source == "modbus" else "provider_retrieval",
                }
                if selected
                else {}
            )
        connection = (
            self.coordinator.connections.get(self.description.key.removesuffix("_status"))
            if hasattr(self.coordinator, "connections")
            else None
        )
        if self.description.key == "cloud_status":
            return {
                **(connection or {}),
                "battery_modules": self.coordinator.cloud_data.get("battery_modules", []),
                "device_inventory": self.coordinator.cloud_data.get("device_inventory", []),
                "module_read_diagnostics": self.coordinator.cloud_data.get("module_read_diagnostics", {}),
                "poll_interval_seconds": getattr(getattr(self.coordinator, "cloud", None), "live_refresh_seconds", 900),
                "request_budget": getattr(
                    getattr(getattr(self.coordinator, "cloud", None), "client", None), "request_gate", None
                ).status
                if getattr(getattr(getattr(self.coordinator, "cloud", None), "client", None), "request_gate", None)
                else {},
            }
        if self.description.key == "modbus_status":
            return {
                **(connection or {}),
                "poll_interval_seconds": getattr(self.coordinator, "poll_seconds", 45),
                "host": self.coordinator.entry.data.get("host"),
                "port": self.coordinator.entry.data.get("port"),
            }
        if (
            not hasattr(self.coordinator, "reading")
            and not observed
            and self.coordinator.entry.data.get("cloud_only")
            and self.description.unit is not None
        ):
            observed = {
                "data_source": "sigenergy_cloud",
                "observed_at": self.coordinator.cloud_data.get("updated_at"),
                "timestamp_basis": "cloud_retrieval",
                "poll_interval_seconds": getattr(getattr(self.coordinator, "cloud", None), "live_refresh_seconds", 900),
            }
        if self.description.key in ("forecast_today", "forecast_tomorrow", "forecast_status"):
            forecast = self.coordinator.forecast_data
            return {
                "data_source": "forecast",
                "available": bool(forecast.get("available")),
                "observed_at": forecast.get("source_updated_at"),
                "series": forecast.get("series", []),
                "series_has_gaps": forecast.get("series_has_gaps"),
                "average": forecast.get("average", False),
                "source_count": forecast.get("source_count", 1 if forecast.get("available") else 0),
                "sources": [{key: row.get(key) for key in ("id", "name", "title", "available", "today_kwh", "tomorrow_kwh", "source_updated_at")} for row in forecast.get("sources", [])],
                "series_source_count": forecast.get("series_source_count"),
            }
        if self.description.key == "control_status":
            from .core.errors import SafetyError
            from .core.owner_settings import mode_catalogue

            try:
                mode_options = mode_catalogue(self.coordinator.cloud_data.get("modes", {}))
            except SafetyError:
                mode_options = []
            return {
                **observed,
                "native_modes": mode_options,
                "strategy_status": getattr(getattr(self.coordinator, "strategies", None), "state", {"state": "disabled"}),
                "owner_devices": self.coordinator.cloud_data.get("owner_controls", {}),
                "config_entry_id": self.coordinator.entry.entry_id,
                "live_writes_locked": self.coordinator.controller.diagnostics()["live_writes_locked"],
                "export_permitted": self.coordinator.controller.limits.export_permitted,
                **(self.coordinator.controls.diagnostics() if getattr(self.coordinator, "controls", None) is not None else {}),
                "manual_until": self.coordinator.controller.manual_until,
                "automation_paused_until": self.coordinator.controller.automation_paused_until,
                "max_duration_minutes": self.coordinator.controller.limits.max_duration_minutes,
                "data_source": self.coordinator.data.source if self.coordinator.data else None,
                "connection_type": "cloud_only" if self.coordinator.entry.data.get("cloud_only") else "local",
                **(
                    {"connections": self.coordinator.connections, "capabilities": self.coordinator.capabilities}
                    if hasattr(self.coordinator, "connections")
                    else {}
                ),
                "manual_control_power": manual_power_metadata(
                    cloud_data=self.coordinator.cloud_data,
                    cloud_error=self.coordinator.cloud_error,
                    snapshot=self.coordinator.data,
                    user_safety=self.coordinator.entry.options.get("safety", {}),
                    demo=self.coordinator.entry.data.get("demo", False),
                    now=utcnow(),
                    local_max_age=self.coordinator.controller.limits.telemetry_max_age,
                ),
                "dashboard": {
                    key: value
                    for key, value in self.coordinator.entry.options.get("dashboard", {}).items()
                    if key in ("preset", "main_display", "appearance", "charts")
                },
            }
        return observed or None
