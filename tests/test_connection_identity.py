"""Exercise the actual read-only identity handler without a Home Assistant host."""

import ast
import asyncio
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("admin,matching,changed", [(False, True, False), (True, True, False), (True, False, False), (True, True, True)])
async def test_identity_probe_is_admin_only_read_only_and_rejects_station_changes(admin, matching, changed):
    node = next(n for n in ast.parse(Path("custom_components/sigen_hybrid/owner_configuration.py").read_text()).body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "websocket_connection_identity")
    node.decorator_list = []
    loaded = object()
    reads, results, errors = [], [], []
    client = SimpleNamespace(station_id="42")

    async def identity(unit):
        reads.append(("modbus-read", unit))
        return "SYNTHETIC-INVERTER"

    async def serials():
        reads.append(("cloud-read", "42"))
        if changed:
            client.station_id = "other-station"
        return ["SYNTHETIC-INVERTER" if matching else "OTHER-INVERTER"]

    client.aio_serials = serials
    entry = SimpleNamespace(domain="sigen_hybrid", state=loaded, options={"cloud": {"station_id": "42"}},
                            runtime_data=SimpleNamespace(local=SimpleNamespace(device_identity=identity),
                            cloud=SimpleNamespace(_connected=True, client=client), _cloud_update_lock=asyncio.Lock()))
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda ident: entry))
    connection = SimpleNamespace(user=SimpleNamespace(is_admin=admin),
                                 send_result=lambda ident, result: results.append(result),
                                 send_error=lambda ident, code, text: errors.append(code))
    scope = {"DOMAIN": "sigen_hybrid", "ConfigEntryState": SimpleNamespace(LOADED=loaded), "sha256": sha256}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "owner_configuration.py", "exec"), scope)
    await scope["websocket_connection_identity"](hass, connection, {"id": 1, "config_entry": "synthetic", "inverter_unit_id": 2})
    if not admin:
        assert not reads and errors == ["unauthorized"]
    elif changed:
        assert not results and errors == ["identity_unavailable"]
    else:
        assert results[0]["matches"] is matching and results[0]["writes_sent"] == 0
        assert "SYNTHETIC-INVERTER" not in str(results)
        assert reads == [("modbus-read", 2), ("cloud-read", "42")]
