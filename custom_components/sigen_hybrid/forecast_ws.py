"""Native forecast preferences; HA providers retain responsibility for polling."""

import hashlib
import json

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState

from .const import DOMAIN
from .core.forecasts import PROVIDERS
from .forecast_sources import configured_sources, source_id


def revision(options):
    return hashlib.sha256(json.dumps(dict(options), sort_keys=True, default=str).encode()).hexdigest()


def forecast_configuration(hass, entry):
    providers, sources = [], []
    for key, info in PROVIDERS.items():
        entries = hass.config_entries.async_entries(info["domain"])
        providers.append({"provider": key, "name": info["name"], "installed": bool(entries), "url": info["url"]})
        for item in entries:
            row = {"provider": key, "entry_id": item.entry_id, "name": info["name"], "title": item.title, "loaded": item.state is ConfigEntryState.LOADED}
            sources.append({**row, "id": source_id(row)})
    current = entry.options.get("forecast", {})
    selected = configured_sources(hass, current)
    return {
        "config_entry": entry.entry_id, "providers": providers, "sources": sources,
        "selected_sources": [source_id(source) for source in selected],
        "primary_source": current.get("primary_source") or (source_id(selected[0]) if selected else ""),
        "average": current.get("average") is True, "revision": revision(current),
    }


def async_register_forecast(hass):
    state = hass.data.setdefault(DOMAIN, {})
    if not state.get("forecast_configuration_registered"):
        websocket_api.async_register_command(hass, websocket_forecast_configuration)
        state["forecast_configuration_registered"] = True


@websocket_api.websocket_command({
    vol.Required("type"): "sigen_hybrid/forecast_configuration",
    vol.Required("config_entry"): str,
    vol.Optional("save", default=False): bool,
    vol.Optional("revision"): str,
    vol.Optional("sources"): vol.All([str], vol.Length(max=32)),
    vol.Optional("primary_source"): str,
    vol.Optional("average", default=False): bool,
})
@websocket_api.async_response
async def websocket_forecast_configuration(hass, connection, message):
    entry = hass.config_entries.async_get_entry(message["config_entry"])
    if entry is None or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(message["id"], "invalid_entry", "Select a loaded Sigenergy TC configuration")
        return
    current = forecast_configuration(hass, entry)
    if not message.get("save"):
        connection.send_result(message["id"], current)
        return
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Administrator required")
        return
    if message.get("revision") != current["revision"]:
        connection.send_error(message["id"], "conflict", "Forecast settings changed on another device. Reopen this page.")
        return
    available = {row["id"]: row for row in current["sources"]}
    identities = message.get("sources", [])
    if message.get("average") is True and len(identities) > 2:
        connection.send_error(message["id"], "too_many_sources", "Choose at most two sources to average")
        return
    primary = message.get("primary_source") or (identities[0] if identities else "")
    if len(set(identities)) != len(identities) or any(identity not in available for identity in identities) or identities and primary not in identities:
        connection.send_error(message["id"], "invalid_sources", "Select configured forecast sources and a selected main source")
        return
    config = {
        "provider": "ensemble" if identities else "none",
        "sources": [{"provider": available[identity]["provider"], "entry_id": available[identity]["entry_id"]} for identity in identities],
        "primary_source": primary, "average": message.get("average") is True,
    }
    hass.config_entries.async_update_entry(entry, options={**entry.options, "forecast": config})
    # Forecast-only option changes are applied in place by the update listener.
    # This must not reconnect Modbus or log into the owner-cloud account.
    connection.send_result(message["id"], forecast_configuration(hass, entry))
