"""All imported dashboard modules must be served when the integration loads."""
import ast
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest


async def test_frontend_serves_only_the_complete_known_asset_set():
    source = Path("custom_components/sigen_hybrid/frontend.py")
    tree = ast.parse(source.read_text())
    namespace = {
        "Path": Path, "__file__": str(source.resolve()), "DOMAIN": "sigen_hybrid", "LOVELACE_DATA": "lovelace",
        "VERSION": "0.2.4",
        "StaticPathConfig": lambda url, path, **kwargs: (url, path, kwargs),
    }
    exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)], type_ignores=[]), str(source), "exec"), namespace)
    served = []

    async def register(paths):
        served.extend(paths)

    await namespace["async_register_frontend"](SimpleNamespace(data={}, http=SimpleNamespace(async_register_static_paths=register)))
    expected = {"sigen-hybrid-presets.js", "sigen-hybrid-status.js", "sigen-hybrid-fit.js", "sigen-hybrid-card.js", "sigen-hybrid-navigation.js", "sigen-hybrid-details.js", "sigen-hybrid-settings.js", "sigen-hybrid-charts.js", "sigen-hybrid-widgets.js", "sigen-hybrid-energy.js", "sigen-hybrid-photo.js", "sigen-hybrid-overview.js", "sigen-hybrid-sankey.js", "sigen-hybrid-house.js", "sigen-hybrid-devices.js", "assets/overview-house-day-v1.webp", "assets/overview-house-night-v1.webp"}
    frontend = source.parent / "frontend"
    assert {str(Path(path).relative_to(frontend.resolve())).replace("\\", "/") for _, path, _ in served} == expected
    assert len(served) == len(expected)
    for url, path, options in served:
        relative = str(Path(path).relative_to(frontend.resolve())).replace("\\", "/")
        assert url == f"/sigen_hybrid/{relative}"
        assert Path(path).is_file()
        assert Path(path).is_relative_to(frontend.resolve())
        assert options == {"cache_headers": False}
    for _, path, _ in served:
        if Path(path).suffix != ".js":
            assert Path(path).read_bytes()[:4] == b"RIFF"
            continue
        for specifier in re.findall(r'''^import .* from ["']([^"']+)["']''', Path(path).read_text(encoding="utf-8"), re.MULTILINE):
            module = specifier.split("?", 1)[0]
            assert module == f"./{Path(module).name}"
            assert Path(module).name in expected


@pytest.mark.parametrize("existing_url", [None, "/sigen_hybrid/sigen-hybrid-card.js", "/sigen_hybrid/sigen-hybrid-card.js?v=0.2.3"])
async def test_resource_registration_versions_new_and_existing_resources(existing_url):
    source = Path("custom_components/sigen_hybrid/frontend.py")
    namespace = {"Path": Path, "__file__": str(source.resolve()), "DOMAIN": "sigen_hybrid", "VERSION": "0.2.4", "LOVELACE_DATA": "lovelace", "StaticPathConfig": lambda *a, **kw: None}
    tree = ast.parse(source.read_text())
    exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)], type_ignores=[]), str(source), "exec"), namespace)
    other = {"id": "other", "url": "/local/another-card.js", "type": "module"}
    rows = [other.copy()] + ([{"id": "tc", "url": existing_url, "type": "module"}] if existing_url else [])
    changes = []

    async def noop(*args):
        pass

    async def create(data):
        rows.append({"id": "tc", **data})
        changes.append("create")

    async def update(identity, data):
        assert identity == "tc"
        rows[1].update(data)
        changes.append("update")

    resources = SimpleNamespace(async_get_info=noop, async_items=lambda: rows, async_create_item=create, async_update_item=update)
    hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resource_mode="storage", resources=resources)}, http=SimpleNamespace(async_register_static_paths=noop))
    await namespace["async_register_frontend"](hass)
    assert rows[0] == other
    assert rows[1]["id"] == "tc" and rows[1]["url"] == "/sigen_hybrid/sigen-hybrid-card.js?v=0.2.4"
    await namespace["async_register_frontend"](hass)
    assert len(changes) == 1


def test_frontend_resource_version_matches_package():
    manifest = json.loads(Path("custom_components/sigen_hybrid/manifest.json").read_text())
    from custom_components.sigen_hybrid.const import VERSION
    assert VERSION == manifest["version"]
