"""HA adapter for explicit charger previews and temporary mode sessions."""

import asyncio

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .core.ac_session import ChargerSession
from .core.control_providers import CloudControlSettings
from .core.control_telemetry import validate_owner_station
from .core.errors import SafetyError, SigenError
from .core.models import utcnow
from .core.owner_settings import prepare_setting


async def async_setup_charger_session(runtime, kind="ac"):
    owner = runtime.controls.cloud
    charging_key = f"{kind}_charging"

    async def provider(serial, writing):
        if not owner.enabled or owner._closing or runtime.entry.data.get("demo"):
            raise SafetyError("Cloud plant control is not enabled")
        cloud = runtime.cloud
        if cloud is None or not cloud._connected:
            raise SafetyError("Cloud is temporarily unavailable")
        selected = str(runtime.entry.options.get("cloud", {}).get("station_id"))
        if str(cloud.station_id) != selected or str(cloud.client.station_id) != selected:
            raise SafetyError("The connected plant does not match this entry")
        if writing:
            if owner._job is not None and not owner._job.done():
                raise SafetyError("Wait for the current plant command to finish")
            session = await owner._bind()  # Includes duplicate-writer claims.
            pending = await session.journal.pending()
            if pending and pending.get("phase") != "confirmed":
                raise SafetyError("Reconcile the previous plant command first")
        else:
            await owner._bind()  # Re-check configured writers and claim after restart.
        candidate = CloudControlSettings(cloud.client, selected, region=owner.region, clock=utcnow)
        # Reconciliation is bound to the previously discovered exact charger;
        # every dispatch/restore additionally checks fresh native inventory.
        if serial is not None and not writing:
            serials = runtime.cloud_data.get("owner_controls", {}).get(f"{kind}SnList", [])
            if serial not in serials:
                raise SafetyError("Select the installed charger returned by this plant")
            candidate = CloudControlSettings(cloud.client, selected, region=owner.region, clock=utcnow,
                **{f"{kind}_serial": serial})
        else:
            station = validate_owner_station(await candidate._request("GET", "device/owner/station/home"), selected,
                require_normal=writing is True)
            await prepare_setting(candidate, charging_key, False, owner_limits=runtime.controller.limits,
                station=station, serial=serial)
        return candidate

    manager = ChargerSession(
        Store(runtime.hass, 1, f"{DOMAIN}_{kind}_session_{runtime.entry.entry_id}"),
        Store(runtime.hass, 1, f"{DOMAIN}_{kind}_mode_{runtime.entry.entry_id}"),
        provider, clock=utcnow, operation_lock=runtime._cloud_update_lock,
        notify=runtime.async_update_listeners, kind=kind,
    )
    await manager.load()
    return manager


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/ac_charge_session",
    vol.Required("config_entry"): str,
    vol.Optional("charger", default="ac"): vol.In(("ac", "dc")),
    vol.Required("operation"): vol.In(("preview", "start", "stop")),
    vol.Optional("serial"): vol.All(str, vol.Length(min=1, max=80)),
    vol.Optional("token"): vol.All(str, vol.Length(min=1, max=80)),
    vol.Optional("temporary_fast", default=False): bool,
})
@websocket_api.async_response
async def websocket_ac_charge_session(hass, connection, message):
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if connection.user is None or not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Only an administrator may control charging")
        return
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC system")
        return
    runtime = entry.runtime_data
    kind = message["charger"]
    manager = getattr(runtime, f"{kind}_session", None)
    if manager is None or runtime.entry.data.get("demo"):
        connection.send_error(message["id"], "control_unavailable", f"{kind.upper()} charging control is unavailable")
        return
    try:
        operation = message["operation"]
        if operation == "preview":
            result = await manager.preview(connection.user.id, message.get("serial"))
        else:
            if manager.busy:
                raise SafetyError(f"A {kind.upper()} charging request is already being processed")
            if operation == "start":
                request = manager.consume(connection.user.id, message.get("token"), message["temporary_fast"])
                coroutine = manager.start(request)
            else:
                serial = message.get("serial")
                if not manager.can_stop or serial != manager.state.get("serial"):
                    raise SafetyError("This charger has no cancellable TC session")
                coroutine = manager.stop(serial)
            manager.job = entry.async_create_background_task(hass, coroutine, f"sigenergy_tc_{kind}_session")
            result = {"phase": "queued", "message": f"Checking {kind.upper()} charging state"}
        connection.send_result(message["id"], result)
    except (SigenError, ValueError, KeyError) as error:
        connection.send_error(message["id"], "ac_session_unavailable", str(error))
    except asyncio.CancelledError:
        raise
    except Exception:
        connection.send_error(message["id"], "ac_session_unavailable", "Could not verify the current charging settings")
