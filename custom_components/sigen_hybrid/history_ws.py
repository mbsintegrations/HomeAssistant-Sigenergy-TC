"""Authenticated, bounded chart reads through the existing owner-cloud session."""

from datetime import datetime

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState

from .const import DOMAIN
from .core.energy import DAILY_COUNTERS
from .core.history import HISTORY_KINDS, HistoryBroker
from .core.models import utcnow


def async_register_history(hass):
    state = hass.data.setdefault(DOMAIN, {})
    if state.get("history_registered"):
        return
    websocket_api.async_register_command(hass, websocket_history)
    websocket_api.async_register_command(hass, websocket_energy_baselines)
    state["history_registered"] = True


def async_remove_entry_history(hass, entry_id):
    hass.data.get(DOMAIN, {}).get("history", {}).pop(entry_id, None)


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/energy_baselines",
    vol.Required("config_entry"): str,
    vol.Required("sources"): {vol.In(DAILY_COUNTERS): {vol.Required("daily"): str, vol.Required("lifetime"): str}},
})
@websocket_api.async_response
async def websocket_energy_baselines(hass, connection, message):
    """Admin-only one-time migration; reads HA states and writes no device."""
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Administrator required")
        return
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC configuration")
        return
    runtime, now = entry.runtime_data, utcnow()
    if runtime.local_error or runtime.data is None or (now - runtime.data.observed_at).total_seconds() > 120 or runtime.energy_store is None:
        connection.send_error(message["id"], "unavailable", "Fresh native Modbus counters required")
        return
    # Validate the complete migration before modifying any baseline.
    from .core.energy import DailyEnergyCounters
    staged = DailyEnergyCounters(str(runtime.energy_counters.timezone))
    staged.restore(runtime.energy_counters.dump())
    try:
        for key, sources in message["sources"].items():
            pair = []
            for source in (sources["daily"], sources["lifetime"]):
                state = hass.states.get(source)
                if state is None or state.state in ("unavailable", "unknown"):
                    raise ValueError("Source unavailable")
                unit = {"Wh": .001, "kWh": 1, "MWh": 1000}[state.attributes.get("unit_of_measurement")]
                stamp = datetime.fromisoformat(state.attributes.get("observed_at") or state.last_updated.isoformat())
                pair.append((float(state.state) * unit, stamp))
            if abs((pair[0][1] - pair[1][1]).total_seconds()) > 120:
                raise ValueError("Counter observations are not aligned")
            staged.seed(key, pair[1][0], pair[0][0], pair[0][1], runtime.data.energy[DAILY_COUNTERS[key]], now)
        await runtime.energy_store.async_save(staged.dump())
        runtime.energy_counters = staged
        from dataclasses import replace
        runtime.async_set_updated_data(replace(runtime.data, energy=staged.update(runtime.data.energy, runtime.data.observed_at)))
        connection.send_result(message["id"], {"migrated": sorted(message["sources"]), "provider_commands": 0})
    except (ValueError, TypeError, KeyError):
        connection.send_error(message["id"], "invalid_counters", "Use aligned same-day daily and lifetime energy sources from this plant")


@websocket_api.websocket_command(
    {
        vol.Required("type"): "sigen_hybrid/history",
        vol.Required("config_entry"): str,
        vol.Required("kind"): vol.In(HISTORY_KINDS),
        vol.Required("period"): vol.In(("day", "week", "month", "year", "lifetime")),
        vol.Required("date"): str,
        vol.Required("start_time"): str,
        vol.Required("end_time"): str,
    }
)
@websocket_api.async_response
async def websocket_history(hass, connection, message):
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC configuration")
        return
    runtime = entry.runtime_data
    cloud = runtime.cloud
    if cloud is None or entry.data.get("demo") or not cloud._connected:
        connection.send_result(message["id"], {"series": [], "source": "cloud_unavailable", "available": False})
        return
    try:
        # Only the regular coordinator/reauthentication flow may initiate a
        # login. Opening multiple charts must never turn failed auth into a
        # series of repeated account logins.
        brokers = hass.data.setdefault(DOMAIN, {}).setdefault("history", {})
        cached = brokers.get(entry.entry_id)
        if cached is None or cached[0] is not cloud.client:
            cached = (
                cloud.client,
                HistoryBroker(cloud.client, timezone=hass.config.time_zone, currency=hass.config.currency),
            )
            brokers[entry.entry_id] = cached
        result = await cached[1].get(
            kind=message["kind"],
            period=message["period"],
            date=message["date"],
            start_time=message["start_time"],
            end_time=message["end_time"],
        )
        connection.send_result(message["id"], result)
    except ValueError:
        connection.send_error(message["id"], "invalid_history_request", "The requested chart period is invalid")
    except Exception:
        # Provider text may include account data. Let the card retain its local
        # HA history without propagating or logging an upstream response.
        connection.send_result(message["id"], {"series": [], "source": "cloud_unavailable", "available": False})
