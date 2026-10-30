import ast
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize(
    "old,expected",
    [
        ("Sigenergy Hybrid", "Sigenergy TC"),
        ("Sigenergy Hybrid Cloud", "Sigenergy TC Cloud"),
        ("Sigenergy Hybrid · My plant", "Sigenergy TC · My plant"),
        ("My plant", "My plant"),
        ("Sigenergy TC Cloud", "Sigenergy TC Cloud"),
        ("sigenergy hybrid", "sigenergy hybrid"),
    ],
)
def test_legacy_entry_display_title_migrates_once_preserving_configuration(old, expected):
    tree = ast.parse(Path("custom_components/sigen_hybrid/__init__.py").read_text())
    node = next(
        item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "_migrate_legacy_title"
    )
    scope = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "__init__.py", "exec"), scope)
    entry = SimpleNamespace(title=old, entry_id="unchanged-entry-id", data={"host": "synthetic"}, options={"cloud": {}})
    data, options, updates = entry.data, entry.options, []

    def update(actual, **kwargs):
        assert actual is entry
        updates.append(kwargs)
        entry.title = kwargs["title"]

    hass = SimpleNamespace(config_entries=SimpleNamespace(async_update_entry=update))
    scope["_migrate_legacy_title"](hass, entry)
    scope["_migrate_legacy_title"](hass, entry)
    assert entry.title == expected and entry.entry_id == "unchanged-entry-id"
    assert entry.data is data and entry.options is options
    assert updates == ([{"title": expected}] if old != expected else [])
