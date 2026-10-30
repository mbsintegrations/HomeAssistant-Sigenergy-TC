"""Native forecast settings are entry-scoped, admin-only and conflict-checked."""

import ast
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.forecasts import PROVIDERS


def handler(admin=True):
    loaded = object()
    entry = SimpleNamespace(entry_id="tc", domain="sigen_hybrid", state=loaded, options={"cloud": {"existing": True}, "safety": {"reserve_soc": 30}, "forecast": {"provider": "none"}})
    entries = [SimpleNamespace(entry_id=key, domain=info["domain"], state=loaded, title=info["name"]) for key, info in PROVIDERS.items()]
    calls, results, errors = [], [], []
    def update(target, **kwargs):
        assert target is entry
        calls.append(kwargs)
        target.options = kwargs["options"]
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda identity: entry if identity == "tc" else None, async_entries=lambda domain: [row for row in entries if row.domain == domain], async_update_entry=update))
    def sources(hass, options):
        return options.get("sources", [])
    scope = {"DOMAIN": "sigen_hybrid", "PROVIDERS": PROVIDERS, "ConfigEntryState": SimpleNamespace(LOADED=loaded), "hashlib": hashlib, "json": json, "configured_sources": sources, "source_id": lambda row: f"{row['provider']}:{row['entry_id']}"}
    tree = ast.parse(Path("custom_components/sigen_hybrid/forecast_ws.py").read_text())
    functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for node in functions:
        node.decorator_list = []
    exec(compile(ast.Module(body=functions, type_ignores=[]), "forecast_ws.py", "exec"), scope)
    connection = SimpleNamespace(user=SimpleNamespace(is_admin=admin), send_result=lambda identity, result: results.append(result), send_error=lambda identity, code, message: errors.append(code))
    config = scope["forecast_configuration"](hass, entry)
    message = {"id": 1, "config_entry": "tc", "save": True, "revision": config["revision"], "sources": ["forecast_solar:forecast_solar", "open_meteo_solar_forecast:open_meteo_solar_forecast"], "primary_source": "forecast_solar:forecast_solar", "average": True}
    return scope["websocket_forecast_configuration"], hass, connection, entry, message, calls, results, errors


async def test_saves_two_real_configured_sources_without_changing_cloud_or_safety():
    command, hass, connection, entry, message, calls, results, errors = handler()
    await command(hass, connection, message)
    assert not errors and len(calls) == 1 and results[0]["average"]
    assert entry.options["cloud"] == {"existing": True} and entry.options["safety"] == {"reserve_soc": 30}
    assert len(entry.options["forecast"]["sources"]) == 2


@pytest.mark.parametrize("reason", ["admin", "entry", "revision", "sources", "limit"])
async def test_rejects_unauthorized_wrong_entry_stale_unknown_or_excessive_sources(reason):
    command, hass, connection, entry, message, calls, _, errors = handler(admin=reason != "admin")
    if reason == "entry":
        message["config_entry"] = "other"
    elif reason == "revision":
        message["revision"] = "stale"
    elif reason == "sources":
        message["sources"] = ["unknown:unknown"]
    elif reason == "limit":
        message["sources"].append("volcast:volcast")
    await command(hass, connection, message)
    assert errors and not calls and entry.options["forecast"] == {"provider": "none"}
