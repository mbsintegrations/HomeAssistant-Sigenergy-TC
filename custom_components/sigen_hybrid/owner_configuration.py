"""Lazy, authenticated owner-setting reads; never another cloud login."""

import asyncio
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
from .core.plant_configuration import SECTIONS, PlantConfiguration


def setting_revision(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def async_register_owner_configuration(hass):
    state = hass.data.setdefault(DOMAIN, {})
    if not state.get("owner_configuration_registered"):
        websocket_api.async_register_command(hass, websocket_owner_configuration)
        websocket_api.async_register_command(hass, websocket_connection_identity)
        websocket_api.async_register_command(hass, websocket_plant_configuration)
        websocket_api.async_register_command(hass, websocket_plant_strategy)
        state["owner_configuration_registered"] = True


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/plant_configuration",
    vol.Required("config_entry"): str,
    vol.Required("section"): vol.In(SECTIONS),
    vol.Optional("serial"): vol.All(str, vol.Length(min=1, max=80)),
    vol.Optional("profile_id"): vol.All(int, vol.Range(min=1)),
    vol.Optional("page", default=1): vol.All(int, vol.Range(min=1, max=100000)),
})
@websocket_api.async_response
async def websocket_plant_configuration(hass, connection, message):
    """Read presets through the existing Cloud session, independently of writes."""
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC system")
        return
    runtime = entry.runtime_data
    if runtime.cloud is None or not runtime.cloud._connected:
        connection.send_error(message["id"], "cloud_unavailable", "Cloud configuration is temporarily unavailable")
        return
    try:
        options = entry.options.get("cloud", {})
        selected = str(options.get("station_id"))
        if str(runtime.cloud.station_id) != selected or str(runtime.cloud.client.station_id) != selected:
            raise ValueError
        # The SDK already serializes authenticated operations and the account
        # gate paces every HTTP request. Do not queue an on-demand preset behind
        # the entire optional device-refresh burst (which can take minutes).
        lock = getattr(runtime, "_plant_configuration_lock", None)
        if lock is None:
            lock = runtime._plant_configuration_lock = asyncio.Lock()
        async with lock:
            reader = getattr(runtime, "_plant_configuration", None)
            if reader is None or reader.client is not runtime.cloud.client or reader.station_id != selected:
                reader = PlantConfiguration(runtime.cloud.client, selected,
                    inventory=lambda: runtime.cloud_data.get("device_inventory", []))
                runtime._plant_configuration = reader
            result = await reader.read(message["section"], serial=message.get("serial"), profile_id=message.get("profile_id"), page=message.get("page", 1))
        if message["section"] == "strategies":
            owner = getattr(getattr(runtime, "controls", None), "cloud", None)
            result["writable"] = owner is not None and owner.enabled and not owner._closing
        connection.send_result(message["id"], result)
    except Exception:
        connection.send_error(message["id"], "configuration_unavailable", "The current plant configuration could not be read")


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/plant_strategy",
    vol.Required("config_entry"): str,
    vol.Required("operation"): vol.In(("preview", "apply", "read", "answer")),
    vol.Optional("action"): vol.In(("create", "edit", "rename", "delete")),
    vol.Optional("rule_id"): vol.All(int, vol.Range(min=1)),
    vol.Optional("name"): vol.All(str, vol.Length(min=1, max=60)),
    vol.Optional("instruction"): vol.All(str, vol.Length(min=1, max=2000)),
    vol.Optional("preview"): vol.All(str, vol.Length(min=36, max=36)),
    vol.Optional("conversation"): vol.All(str, vol.Length(min=36, max=36)),
    vol.Optional("button"): vol.All(int, vol.Range(min=0, max=20)),
})
@websocket_api.async_response
async def websocket_plant_strategy(hass, connection, message):
    """One owner-confirmed native operation; no arbitrary API action payloads."""
    from homeassistant.helpers.storage import Store

    from .core.errors import SafetyError
    from .core.plant_strategies import PlantStrategies

    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "An administrator is required")
        return
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC system")
        return
    runtime = entry.runtime_data
    owner = getattr(getattr(runtime, "controls", None), "cloud", None)
    if (entry.data.get("demo") or entry.options.get("control", {}).get("enabled") is not True
            or owner is None or not owner.enabled or owner._closing
            or runtime.cloud is None or not runtime.cloud._connected):
        connection.send_error(message["id"], "control_unavailable", "Enable Cloud plant control before managing native strategies")
        return
    try:
        selected = str(entry.options.get("cloud", {}).get("station_id"))
        if str(runtime.cloud.station_id) != selected or str(runtime.cloud.client.station_id) != selected:
            raise SafetyError("The connected plant changed; reopen its strategies")
        lock = getattr(runtime, "_native_strategy_lock", None)
        if lock is None:
            lock = runtime._native_strategy_lock = asyncio.Lock()
        async with owner.operation_lock, owner._lock, lock:
            session = await owner._bind()  # Shared ownership and live identity guards.
            if await session.journal.pending() or owner._job is not None and not owner._job.done():
                raise SafetyError("Finish the current plant control before changing its strategies")
            local = getattr(runtime.controls, "local", None)
            if local is not None and local.enabled and local.operation.get("phase") not in (None, "idle", "restored", "confirmed", "superseded"):
                raise SafetyError("Finish the current local control before changing plant strategies")
            backend = getattr(runtime, "_native_strategies", None)
            if backend is None or backend.reader.client is not runtime.cloud.client or backend.reader.station_id != selected:
                reader = PlantConfiguration(runtime.cloud.client, selected)
                store = Store(hass, 1, f"{DOMAIN}_native_strategy_{entry.entry_id}")
                backend = runtime._native_strategies = PlantStrategies(reader, store.async_save)
            user = connection.user.id
            operation = message["operation"]
            if operation == "preview":
                result = await backend.preview(user, message.get("action"), rule_id=message.get("rule_id"), name=message.get("name"), instruction=message.get("instruction"))
            elif operation == "apply":
                result = await backend.apply(user, message.get("preview"))
            elif operation == "read":
                result = await backend.read_conversation(user, message.get("conversation"))
            else:
                result = await backend.answer(user, message.get("conversation"), instruction=message.get("instruction"), button=message.get("button"))
            cached = getattr(runtime, "_plant_configuration", None)
            if cached is not None and operation != "preview":
                cached.cache.pop(("strategies", None, None, 1), None)
        connection.send_result(message["id"], result)
    except SigenError as error:
        connection.send_error(message["id"], "strategy_unavailable", str(error))
    except Exception:
        connection.send_error(message["id"], "strategy_unconfirmed", "The strategy request was not confirmed. Refresh the plant before trying again.")


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
        cloud_ready = runtime.cloud is not None and runtime.cloud._connected
        use_cloud_grid = cloud_ready and message["setting"] in ("grid_export_limit", "grid_import_limit")
        use_local = getattr(runtime, "local", None) is not None and message["setting"] in LOCAL_SETTINGS and not use_cloud_grid
        if use_local:
            from .local_controls import setting_revision as local_revision
            if local is not None and local.enabled:
                async with local.operation_lock, local._lock:
                    session = await local._bind()
                    provider = session.journal.provider
                    value = (await provider.read([message["setting"]]))[message["setting"]]
                    identity = await provider.identity()
            else:
                # Monitoring permission is independent of write ownership. Do
                # not claim a control lease or enable remote EMS just to read.
                from .core.local_control import LocalControlSettings
                async def identity_reader():
                    return "read-only:"+entry.entry_id
                provider = LocalControlSettings(runtime.local, identity_reader, max_charge_kw=None, max_discharge_kw=None)
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
        lock = getattr(runtime, "_owner_configuration_lock", None)
        if lock is None:
            lock = runtime._owner_configuration_lock = asyncio.Lock()
        async with lock:
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
