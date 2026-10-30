"""All imported dashboard modules must be served when the integration loads."""
import ast
import re
from pathlib import Path
from types import SimpleNamespace


async def test_frontend_serves_only_the_complete_known_asset_set():
    source = Path("custom_components/sigen_hybrid/frontend.py")
    tree = ast.parse(source.read_text())
    namespace = {
        "Path": Path, "__file__": str(source.resolve()), "DOMAIN": "sigen_hybrid", "LOVELACE_DATA": "lovelace",
        "StaticPathConfig": lambda url, path, **kwargs: (url, path, kwargs),
    }
    exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)], type_ignores=[]), str(source), "exec"), namespace)
    served = []

    async def register(paths):
        served.extend(paths)

    await namespace["async_register_frontend"](SimpleNamespace(data={}, http=SimpleNamespace(async_register_static_paths=register)))
    expected = {"sigen-hybrid-card.js", "sigen-hybrid-navigation.js", "sigen-hybrid-details.js", "sigen-hybrid-settings.js", "sigen-hybrid-charts.js", "sigen-hybrid-widgets.js", "sigen-hybrid-energy.js", "sigen-hybrid-photo.js", "sigen-hybrid-overview.js", "sigen-hybrid-sankey.js", "sigen-hybrid-house.js", "sigen-hybrid-devices.js", "assets/overview-house-day-v1.webp", "assets/overview-house-night-v1.webp"}
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
