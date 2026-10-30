"""Independent local/cloud updates. Cloud failure never erases local telemetry."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import replace
from datetime import timedelta

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DEFAULT_POLL_SECONDS, DOMAIN
from .core.connections import capabilities, connection_states, enabled_connections, select_reading
from .core.control import Controller
from .core.energy import DailyEnergyCounters
from .core.errors import AuthenticationError
from .core.models import SafetyLimits, Snapshot, utcnow
from .forecast import async_forecast_overview

LOGGER = logging.getLogger(__name__)


def demo_snapshot() -> Snapshot:
    return Snapshot(utcnow(), 50, 2, 1.5, 0, 0.5, 20, 5, 5, backup_soc=10, native_mode=1, source="demo")


class SigenCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry, local=None, cloud=None):
        self.poll_seconds = max(
            60 if entry.data.get("shared_read_only") else 15,
            min(300, int(entry.data.get("poll_seconds", DEFAULT_POLL_SECONDS))),
        )
        super().__init__(
            hass, LOGGER, name=DOMAIN, config_entry=entry, update_interval=timedelta(seconds=self.poll_seconds)
        )
        self.entry = entry
        self.non_forecast_configuration = (
            dict(entry.data),
            {key: value for key, value in entry.options.items() if key != "forecast"},
        )
        self.local = local
        self.cloud = cloud
        self.local_error = None
        self.cloud_data = {}
        self.cloud_error = None
        self._cloud_tasks = set()
        self._cloud_update_lock = asyncio.Lock()
        self._closing = False
        self.forecast_data = {}
        self.energy_counters = DailyEnergyCounters(getattr(getattr(hass, "config", None), "time_zone", "UTC"))
        self.energy_store = None
        self.controls = None
        self.strategies = None
        self.source_binding_verified = False
        self.controller = Controller(
            SafetyLimits(**entry.options.get("safety", {})), demo=entry.data.get("demo", False)
        )

    async def _async_setup(self):
        from hashlib import sha256

        from homeassistant.helpers.storage import Store

        self.energy_store = Store(self.hass, 1, f"{DOMAIN}_energy_{self.entry.entry_id}")
        self.energy_counters.restore(await self.energy_store.async_load())
        from .controls import OwnerControls
        from .local_controls import HybridOwnerControls, LocalOwnerControls

        cloud = self.entry.options.get("cloud", {})
        plant_key = sha256(f"{cloud.get('region')}:{cloud.get('station_id')}".encode()).hexdigest()
        cloud_controls = OwnerControls(self, Store(self.hass, 1, f"{DOMAIN}_control_{plant_key}"))
        local_key = sha256(f"{self.entry.data.get('host')}:{self.entry.data.get('port',502)}".encode()).hexdigest()
        local_controls = LocalOwnerControls(self, Store(self.hass, 1, f"{DOMAIN}_local_control_{local_key}"), clock=utcnow)
        self.controls = HybridOwnerControls(cloud_controls, local_controls,
            Store(self.hass, 1, f"{DOMAIN}_source_binding_{self.entry.entry_id}"))
        if self.controls.enabled:
            self.controller.executor = self.controls
        from .strategies import StrategyRunner
        self.strategies = StrategyRunner(self)
        await self.strategies.setup()

    async def _async_update_data(self):
        try:
            self.forecast_data = await async_forecast_overview(self.hass, self.entry.options.get("forecast", {}))
        except Exception:
            self.forecast_data = {"available": False}
        if self.entry.data.get("demo"):
            return demo_snapshot()
        if self.local is None:
            return None
        try:
            snapshot = await self.local.snapshot()
            if snapshot.energy:
                snapshot = replace(snapshot, energy=self.energy_counters.update(snapshot.energy, snapshot.observed_at))
                if self.energy_store:
                    self.energy_store.async_delay_save(self.energy_counters.dump, 30)
            self.local_error = None
            return snapshot
        except Exception:
            self.local_error = "unavailable"
            # Availability is per transport/entity; one local outage must not
            # mark independent cloud/API sensors unavailable through HA's coordinator.
            return self.data

    @property
    def reading_sources(self):
        local = self.data
        return {
            "modbus": {
                "observed_at": local.observed_at.isoformat() if local else None,
                "values": {**vars(local), **local.energy, "grid_status": ("On Grid" if local.on_grid else "Off Grid")}
                if local
                else {},
            },
            "cloud": {
                "observed_at": self.cloud_data.get("telemetry_observed_at", self.cloud_data.get("updated_at")),
                "values": self.cloud_data.get("telemetry", {}),
            },
        }

    @property
    def connections(self):
        enabled = enabled_connections(self.entry.data, self.entry.options)
        configured = {
            "modbus": bool(self.entry.data.get("host")),
            "cloud": bool(self.entry.options.get("cloud")),
        }
        health_sources = self.reading_sources
        result = connection_states(
            enabled,
            configured,
            health_sources,
            {"modbus": self.local_error, "cloud": self.cloud_error},
            utcnow(),
        )
        result["modbus"].update(
            read_only=bool(self.entry.data.get("shared_read_only")),
            poll_interval_seconds=self.poll_seconds,
            trace=dict(getattr(self.local, "trace", {})),
        )
        gate = getattr(getattr(self.cloud, "client", None), "request_gate", None)
        if gate and enabled["cloud"] and gate.status["reason"]:
            result["cloud"]["status"] = gate.status["reason"]
        return result

    @property
    def capabilities(self):
        result = capabilities(self.connections)
        if self.controls is not None and self.controls.enabled:
            local_enabled = getattr(getattr(self.controls, "local", None), "enabled", False)
            cloud_enabled = getattr(getattr(self.controls, "cloud", self.controls), "enabled", False)
            local_online = local_enabled and self.connections["modbus"]["status"] == "connected"
            cloud_online = cloud_enabled and self.connections["cloud"]["status"] == "connected"
            online = local_online or cloud_online and self.controls.manual_supported is not False
            result["manual_control"] = {
                "supported": True,
                "online": online,
                "available": online,
                "routes": (["modbus"] if local_enabled else []) + (["cloud"] if cloud_enabled else []),
                "reason": None if online else "temporarily_unavailable",
            }
            owner = self.cloud_data.get("owner_controls", {})
            available = {
                "native_mode": bool(self.cloud_data.get("modes", {}).get("defaultWorkingModes")),
                "grid_switch": owner.get("hasGateway") is True,
                "ac_charging": owner.get("hasAcCharger") is True and bool(owner.get("acSnList")),
                "dc_charging": owner.get("hasEv") is True and bool(owner.get("dcSnList")),
                "battery_levels": True,
            }
            from .core.native_settings import EXTENDED_SETTINGS, charger_key
            for key in EXTENDED_SETTINGS | {"grid_export_limit", "grid_import_limit", "battery_export_block"}:
                device = charger_key(key)
                available[key] = available.get(device, True) if device else True
            from .core.local_control import LOCAL_SETTINGS
            for feature, supported in available.items():
                routes = (["modbus"] if local_enabled and feature in LOCAL_SETTINGS else []) + (["cloud"] if cloud_enabled and supported else [])
                supported = bool(routes)
                setting_online = bool(local_online and feature in LOCAL_SETTINGS or cloud_online and "cloud" in routes)
                result[feature] = {
                    "supported": supported, "online": setting_online, "available": supported and setting_online,
                    "routes": routes,
                    "reason": None if supported and setting_online else "temporarily_unavailable" if supported else "unsupported",
                }
        return result

    def reading(self, key):
        if self.entry.data.get("demo") and self.data is not None:
            from .core.connections import Reading

            value = getattr(self.data, key, None)
            return Reading(value, "demo", self.data.observed_at.isoformat()) if value is not None else None
        return select_reading(key, self.reading_sources, self.connections, utcnow())

    async def async_cloud_update(self, _now=None):
        if self._closing:
            return
        task = asyncio.current_task()
        self._cloud_tasks.add(task)
        try:
            async with self._cloud_update_lock:
                if self.cloud is None:
                    cloud_options = self.entry.options.get("cloud")
                    if not cloud_options or not enabled_connections(self.entry.data, self.entry.options)["cloud"]:
                        return
                    from .cloud_client import async_create_cloud_client
                    from .core.cloud import CloudAdapter

                    client = await async_create_cloud_client(self.hass, cloud_options)
                    self.cloud = CloudAdapter(
                        client,
                        expected_station_id=cloud_options["station_id"],
                        unofficial_opt_in=cloud_options["unofficial_opt_in"],
                        live_refresh_seconds=60 if self.local is None else 900,
                    )
                self.cloud_data = await self.cloud.refresh()
                gate = getattr(getattr(self.cloud, "client", None), "request_gate", None)
                if gate is not None and gate.auth_blocked:
                    raise AuthenticationError("Cloud sign-in requires attention")
                self.cloud_error = None
        except AuthenticationError:
            self.cloud_error = "authentication_required"
            self.entry.async_start_reauth(self.hass)
        except Exception:
            gate = getattr(getattr(self.cloud, "client", None), "request_gate", None)
            if gate is not None and gate.auth_blocked:
                self.cloud_error = "authentication_required"
                self.entry.async_start_reauth(self.hass)
            else:
                self.cloud_error = "Cloud unavailable or authentication required"
        finally:
            self._cloud_tasks.discard(task)
            if not self._closing:
                self.async_update_listeners()

    async def async_close(self):
        self._closing = True
        if self.strategies is not None:
            await self.strategies.close()
        if self.controls is not None:
            await self.controls.close()
        tasks = [task for task in self._cloud_tasks if task is not asyncio.current_task()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            if self.energy_store:
                await self.energy_store.async_save(self.energy_counters.dump())
        finally:
            results = await asyncio.gather(
                *(provider.close() for provider in (self.local, self.cloud) if provider is not None),
                return_exceptions=True,
            )
            if any(isinstance(result, Exception) for result in results):
                LOGGER.warning("A Sigenergy connection did not close cleanly")
