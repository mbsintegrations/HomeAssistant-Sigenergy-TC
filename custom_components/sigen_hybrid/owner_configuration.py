"""Lazy, authenticated owner-setting reads; never another cloud login."""

import json
from hashlib import sha256

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState

from .const import DOMAIN
from .core.control_providers import CloudControlSettings
from .core.control_telemetry import validate_owner_station
from .core.errors import SigenError
from .core.native_settings import charger_key
from .core.owner_settings import SETTINGS, prepare_setting


def setting_revision(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def async_register_owner_configuration(hass):
    state = hass.data.setdefault(DOMAIN, {})
    if not state.get("owner_configuration_registered"):
        websocket_api.async_register_command(hass, websocket_owner_configuration)
        websocket_api.async_register_command(hass, websocket_connection_identity)
        state["owner_configuration_registered"] = True


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/connection_identity",
    vol.Required("config_entry"): str,
    vol.Required("inverter_unit_id"): vol.All(vol.Coerce(int), vol.Range(min=1, max=246)),
})
@websocket_api.async_response
async def websocket_connection_identity(hass, connection, message):
    """A single documented serial read plus cloud inventory; never a command."""
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "An administrator is required")
        return
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC system")
        return
    runtime = entry.runtime_data
    try:
        if runtime.local is None or runtime.cloud is None or not runtime.cloud._connected:
            raise ValueError
        selected = str(entry.options.get("cloud", {}).get("station_id"))
        if str(runtime.cloud.client.station_id) != selected:
            raise ValueError
        serial = await runtime.local.device_identity(message["inverter_unit_id"])
        async with runtime._cloud_update_lock:
            serials = await runtime.cloud.client.aio_serials()
        if str(runtime.cloud.client.station_id) != selected:
            raise ValueError
        connection.send_result(message["id"], {"matches": serial in serials,
            "inverter_unit_id": message["inverter_unit_id"], "cloud_inverter_count": len(serials),
            "local_identity": sha256(serial.encode()).hexdigest(), "writes_sent": 0})
    except Exception:
        connection.send_error(message["id"], "identity_unavailable", "Both source identities could not be read")


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/owner_configuration",
    vol.Required("config_entry"): str,
    vol.Required("setting"): vol.In(SETTINGS),
    vol.Optional("serial"): vol.All(str, vol.Length(min=1, max=80)),
})
@websocket_api.async_response
async def websocket_owner_configuration(hass, connection, message):
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC system")
        return
    runtime = entry.runtime_data
    try:
        local = getattr(getattr(runtime, "controls", None), "local", None)
        from .core.local_control import LOCAL_SETTINGS
        cloud_controls = getattr(getattr(runtime, "controls", None), "cloud", None)
        use_cloud_grid = cloud_controls is not None and cloud_controls.enabled and message["setting"] in ("grid_export_limit", "grid_import_limit")
        if local is not None and local.enabled and message["setting"] in LOCAL_SETTINGS and not use_cloud_grid:
            from .local_controls import setting_revision as local_revision
            async with local.operation_lock, local._lock:
                session = await local._bind()
                provider = session.journal.provider
                value = (await provider.read([message["setting"]]))[message["setting"]]
                identity = await provider.identity()
            connection.send_result(message["id"], {"setting": message["setting"], "value": value,
                "revision": local_revision(identity, value), "metadata": {}, "serial": None, "route": "modbus"})
            return
        if runtime.cloud is None or not runtime.cloud._connected:
            connection.send_error(message["id"], "cloud_unavailable", "Cloud settings are temporarily unavailable")
            return
        key = message["setting"]
        options = entry.options.get("cloud", {})
        selected = str(options.get("station_id"))
        if str(runtime.cloud.station_id) != selected or str(runtime.cloud.client.station_id) != selected:
            connection.send_error(message["id"], "identity_changed", "The connected plant does not match this entry")
            return
        async with runtime._cloud_update_lock:
            provider = CloudControlSettings(runtime.cloud.client, selected, region=options.get("region", "eu"))
            if charger_key(key) or key in ("ac_charging", "dc_charging", "grid_connection"):
                station = validate_owner_station(
                    await provider._request("GET", "device/owner/station/home"), selected, require_normal=False,
                )
                # Preparation binds exact discovered hardware. Its value validation
                # is deliberately deferred until after the first native read.
                if charger_key(key):
                    device = charger_key(key)
                    await prepare_setting(provider, device, False, owner_limits=runtime.controller.limits,
                                          station=station, serial=message.get("serial"))
                elif key == "grid_connection":
                    provider.gateway = station.get("hasGateway") is True
                else:
                    await prepare_setting(provider, key, False, owner_limits=runtime.controller.limits,
                                          station=station, serial=message.get("serial"))
            value = (await provider.read([key]))[key]
            meta = provider.extended_metadata.get(key, {})
            metadata = {}
            if key == "solar_priority" and isinstance(meta, list):
                from .core.native_settings import destination_id
                metadata["destinations"] = [{"id": destination_id(row),
                    "label": row.get("loadName") or row.get("smartLoadsName") or f"Destination {index+1}"}
                    for index, row in enumerate(meta)]
            if isinstance(meta, dict):
                metadata = {field: meta[field] for field in (
                    "installerSetLimitation", "socLowerLimit", "socUpperLimit", "minimumDischargeCutoffSoc",
                    "maximumDischargeCutoffSoc", "ratedPower",
                ) if field in meta}
            if key in provider._grid_limits:
                metadata["installer_limit_kw"] = provider._grid_limits[key].get("maxLimitationInstaller")
            serial = provider.devices.get(charger_key(key) or key)
        connection.send_result(message["id"], {
            "setting": key, "value": value, "revision": setting_revision(value),
            "metadata": metadata, "serial": serial,
        })
    except SigenError:
        metadata = getattr(locals().get("provider"), "extended_metadata", {}).get(message["setting"])
        fields = ({name: {"type": type(value).__name__, "empty": value in (None, "")} for name, value in metadata.items()}
                  if isinstance(metadata, dict) else [])
        connection.send_result(message["id"], {"error": "The system did not return complete settings", "observed_fields": fields})
    except Exception:
        connection.send_error(message["id"], "settings_unavailable", "Could not read the current plant setting")
