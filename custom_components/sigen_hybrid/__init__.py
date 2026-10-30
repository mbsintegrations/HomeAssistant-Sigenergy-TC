"""Sigenergy TC (Total Control), with explicit owner authorization for writes."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import timedelta

import voluptuous as vol
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_interval
from pymodbus.client import AsyncModbusTcpClient

from .cloud_client import async_create_cloud_client
from .const import DOMAIN
from .coordinator import SigenCoordinator
from .core.cloud import CloudAdapter
from .core.connections import enabled_connections
from .core.errors import SigenError
from .core.modbus import ModbusTransport
from .core.models import Intent, Mode, Source, utcnow, validate_duration_minutes, validate_manual_power
from .core.owner_settings import SETTINGS
from .core.planner import Forecast, charging_plan
from .core.tariffs import TariffPlan
from .forecast import async_forecast, async_forecast_overview
from .forecast_ws import async_register_forecast
from .frontend import async_register_frontend
from .history_ws import async_register_history, async_remove_entry_history
from .owner_configuration import async_register_owner_configuration

PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass, config):
    await async_register_frontend(hass)
    async_register_history(hass)
    async_register_forecast(hass)
    async_register_owner_configuration(hass)

    async def coordinator(call, *, refresh=True):
        entry = hass.config_entries.async_get_entry(call.data["config_entry"])
        if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
            raise HomeAssistantError("Select a loaded Sigenergy TC configuration")
        runtime = entry.runtime_data
        if (
            refresh
            and runtime.data is not None
            and (utcnow() - runtime.data.observed_at).total_seconds() > runtime.controller.limits.telemetry_max_age
        ):
            await runtime.async_refresh()
        return runtime

    async def manual_control(call):
        runtime = await coordinator(call, refresh=call.data["dry_run"])
        if not call.data["dry_run"] and call.context.user_id is not None:
            user = await hass.auth.async_get_user(call.context.user_id)
            if user is None or not user.is_admin:
                raise HomeAssistantError("Only an administrator may authorize plant control")
        intent = Intent(
            Mode(call.data["mode"]),
            Source.MANUAL if call.context.user_id is not None else Source.AUTOMATION,
            call.data["duration_minutes"],
            call.data.get("power_kw"),
            call.data.get("export_requested", False),
            **({"request_id": call.data["request_id"]} if "request_id" in call.data else {}),
        )
        try:
            if runtime.controls is not None and runtime.controls.enabled:
                return (
                    await runtime.controls.preview(intent)
                    if call.data["dry_run"]
                    else await runtime.controls.submit(intent)
                )
            if runtime.data is None or not runtime.last_update_success or runtime.local_error:
                raise HomeAssistantError("Fresh local telemetry is required")
            result = await runtime.controller.execute(intent, runtime.data, utcnow(), dry_run=call.data["dry_run"])
        except SigenError as err:
            raise HomeAssistantError(str(err)) from None
        runtime.async_update_listeners()
        return asdict(result)

    async def cancel_manual_control(call):
        runtime = await coordinator(call, refresh=False)
        if call.context.user_id is not None:
            user = await hass.auth.async_get_user(call.context.user_id)
            if user is None or not user.is_admin:
                raise HomeAssistantError("Only an administrator may release plant control")
        try:
            if runtime.controls is None:
                raise HomeAssistantError("No owner control runtime is available")
            return await runtime.controls.cancel()
        except SigenError as err:
            raise HomeAssistantError(str(err)) from None

    async def owner_setting(call):
        runtime = await coordinator(call, refresh=False)
        if not call.data["dry_run"] and call.context.user_id is not None:
            user = await hass.auth.async_get_user(call.context.user_id)
            if user is None or not user.is_admin:
                raise HomeAssistantError("Only an administrator may authorize plant settings")
        try:
            if runtime.controls is None:
                raise HomeAssistantError("No owner control runtime is available")
            return await runtime.controls.setting(
                call.data["setting"], call.data["value"], request_id=call.data["request_id"],
                source=Source.MANUAL if call.context.user_id is not None else Source.AUTOMATION,
                dry_run=call.data["dry_run"], serial=call.data.get("serial"),
                **({"expected_revision": call.data["expected_revision"]} if "expected_revision" in call.data else {}),
            )
        except SigenError as err:
            raise HomeAssistantError(str(err)) from None

    async def preview_plan(call):
        runtime = await coordinator(call)
        if runtime.data is None or not runtime.last_update_success or runtime.local_error:
            raise HomeAssistantError("Fresh local telemetry is required")
        now = utcnow()
        try:
            tariff = TariffPlan.from_dict(json.loads(call.data["tariff_json"]))
            forecast_options = runtime.entry.options.get("forecast", {})
            forecast_data = await async_forecast(hass, forecast_options, now)
            if not forecast_data.get("available"):
                raise ValueError(forecast_data.get("reason", "Forecast unavailable"))
            forecast = Forecast(
                now, forecast_data["solar_24h_kwh"], call.data["demand_24h_kwh"], source=forecast_data["provider"]
            )
            return charging_plan(runtime.data, runtime.controller.limits, tariff, forecast, now)
        except ValueError, KeyError, TypeError, SigenError:
            raise HomeAssistantError(
                "Plan rejected: check tariffs, fresh telemetry and a complete 24-hour forecast"
            ) from None

    hass.services.async_register(
        DOMAIN,
        "manual_control",
        manual_control,
        schema=vol.Schema(
            {
                vol.Required("config_entry"): str,
                vol.Required("mode"): vol.In([m.value for m in Mode]),
                vol.Optional("duration_minutes", default=30): validate_duration_minutes,
                vol.Optional("power_kw"): validate_manual_power,
                vol.Optional("export_requested", default=False): bool,
                vol.Optional("dry_run", default=True): bool,
                vol.Optional("request_id"): vol.All(str, vol.Length(min=1, max=128)),
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        "cancel_manual_control",
        cancel_manual_control,
        schema=vol.Schema({vol.Required("config_entry"): str}),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        "owner_setting",
        owner_setting,
        schema=vol.Schema({
            vol.Required("config_entry"): str,
            vol.Required("setting"): vol.In(SETTINGS),
            vol.Required("value"): vol.Any(dict, bool),
            vol.Required("request_id"): vol.All(str, vol.Length(min=1, max=128)),
            vol.Optional("dry_run", default=True): bool,
            vol.Optional("serial"): vol.All(str, vol.Length(min=1, max=80)),
            vol.Optional("expected_revision"): vol.All(str, vol.Match(r"^[0-9a-f]{64}$")),
        }),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        "preview_plan",
        preview_plan,
        schema=vol.Schema(
            {
                vol.Required("config_entry"): str,
                vol.Required("tariff_json"): str,
                vol.Required("demand_24h_kwh"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1000)),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    return True


def _migrate_legacy_title(hass, entry):
    legacy = "Sigenergy Hybrid"
    if entry.title.startswith(legacy):
        hass.config_entries.async_update_entry(entry, title="Sigenergy TC" + entry.title[len(legacy) :])


async def async_setup_entry(hass, entry):
    # Do this before registering the update listener: branding must not cause
    # another entry reload or account login during setup.
    _migrate_legacy_title(hass, entry)
    if "api" in entry.options or "api" in entry.options.get("connections", {}):
        options = {key: value for key, value in entry.options.items() if key != "api"}
        if "connections" in options:
            options["connections"] = {
                key: value for key, value in options["connections"].items() if key in ("modbus", "cloud")
            }
        hass.config_entries.async_update_entry(entry, options=options)
    async_register_history(hass)
    local = cloud = None
    enabled = enabled_connections(entry.data, entry.options)
    startup_errors = {}
    competing = any(e.state is ConfigEntryState.LOADED for e in hass.config_entries.async_entries("sigen"))
    if enabled["modbus"] and (not competing or entry.data.get("shared_read_only") or entry.data.get("allow_shared_writes")) and entry.data.get("host"):
        client = AsyncModbusTcpClient(entry.data["host"], port=entry.data["port"], timeout=5, retries=0)
        local = ModbusTransport(client, read_only=entry.data.get("shared_read_only", False))
        try:
            await client.connect()
        except Exception:
            startup_errors["modbus"] = "unavailable"
    elif enabled["modbus"] and competing:
        startup_errors["modbus"] = "competing_client"
    cloud_options = entry.options.get("cloud")
    try:
        if cloud_options and enabled["cloud"]:
            try:
                client = await async_create_cloud_client(hass, cloud_options)
                cloud = CloudAdapter(
                    client,
                    cloud_options["station_id"],
                    unofficial_opt_in=cloud_options["unofficial_opt_in"],
                    live_refresh_seconds=60 if not enabled["modbus"] else 900,
                )
            except Exception:
                startup_errors["cloud"] = "unavailable"
        runtime = SigenCoordinator(hass, entry, local, cloud)
        for route, error in startup_errors.items():
            setattr(runtime, f"{'local' if route == 'modbus' else route}_error", error)
        entry.runtime_data = runtime
        await runtime.async_config_entry_first_refresh()
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        entry.async_on_unload(entry.add_update_listener(async_reload_entry))
        entry.async_on_unload(async_track_time_interval(hass, runtime.async_cloud_update, timedelta(seconds=60)))
        if runtime.controls is not None:
            entry.async_on_unload(async_track_time_interval(hass, runtime.controls.reconcile, timedelta(seconds=30)))
        if runtime.strategies is not None:
            entry.async_on_unload(async_track_time_interval(hass, runtime.strategies.tick, timedelta(seconds=30)))
        if cloud is not None:
            entry.async_create_background_task(hass, runtime.async_cloud_update(), "sigen_hybrid_cloud_initial")
        return True
    except Exception:
        if local is not None:
            await local.close()
        if cloud is not None:
            await cloud.close()
        raise


async def async_reload_entry(hass, entry):
    runtime = getattr(entry, "runtime_data", None)
    configuration = (dict(entry.data), {key: value for key, value in entry.options.items() if key != "forecast"})
    if runtime is not None and getattr(runtime, "non_forecast_configuration", None) == configuration:
        runtime.forecast_data = await async_forecast_overview(hass, entry.options.get("forecast", {}))
        runtime.async_update_listeners()
        return
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass, entry):
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        async_remove_entry_history(hass, entry.entry_id)
        await entry.runtime_data.async_close()
        return True
    return False
