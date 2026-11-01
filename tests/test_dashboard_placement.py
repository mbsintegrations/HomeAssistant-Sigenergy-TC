import sys
from contextvars import ContextVar
from copy import deepcopy
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.dashboard_placement import fingerprint, place, targets


@pytest.mark.asyncio
async def test_placement_uses_authenticated_request_and_rejects_non_admin(monkeypatch):
    from custom_components.sigen_hybrid.dashboard_placement import dashboards

    request = ContextVar("test_request", default=None)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.http", SimpleNamespace(current_request=request))
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace.const", SimpleNamespace(LOVELACE_DATA="lovelace"))
    user = SimpleNamespace(id="owner", is_admin=True)

    async def lookup(identity):
        assert identity == "owner"
        return user

    hass = SimpleNamespace(auth=SimpleNamespace(async_get_user=lookup), data={})
    with pytest.raises(PermissionError):
        await dashboards(hass)
    request.set({"hass_user": user})
    assert await dashboards(hass) == {}
    user.is_admin = False
    with pytest.raises(PermissionError):
        await dashboards(hass)


@pytest.mark.asyncio
async def test_save_preserves_rollback_and_rejects_edits_during_backup(monkeypatch):
    from custom_components.sigen_hybrid.dashboard_placement import save

    original = fixture()
    changed = place(original, "view:1", "entry", {})
    stored, saves = [], []
    current = deepcopy(original)

    class Store:
        def __init__(self, *args):
            pass

        async def async_load(self):
            return []

        async def async_save(self, value):
            stored.extend(value)
            current["concurrent_editor"] = True

    async def load(force):
        return current

    async def apply(config):
        saves.append(config)

    monkeypatch.setitem(sys.modules, "homeassistant.helpers.storage", SimpleNamespace(Store=Store))
    dashboard = SimpleNamespace(async_load=load, async_save=apply, url_path="tablet")
    with pytest.raises(ValueError, match="changed"):
        await save(None, dashboard, original, changed, "entry")
    assert stored[0]["before"] == original
    assert not saves


def fixture():
    return {"kiosk_mode": {"hide_header": True, "hide_sidebar": True}, "views": [
        {"title": "Tablet", "cards": [{"type": "custom:taba7-dashboard-shell", "pages": [
            {"name": "Home", "card": {"type": "markdown", "content": "Preserve"}},
            {"name": "Solar", "kind": "solar"},
        ]}]}, {"title": "Other", "type": "sections", "sections": []},
    ]}


def test_shell_placement_changes_only_selected_page_and_never_mutates_original():
    before = fixture()
    saved = deepcopy(before)
    key = next(key for key, item in targets(before).items() if item["label"].endswith("/ Solar"))
    result = place(before, key, "entry", {})
    added = result["views"][0]["cards"][0]["pages"][1].pop("card")
    assert added["embed_mode"] == "shell"
    assert added["config_entry"] == "entry"
    assert added["main_display"] == "photo"
    assert result == before == saved


def test_replacing_existing_shell_card_needs_confirmation():
    key = "shell:views.0.cards.0:0"
    with pytest.raises(ValueError, match="Confirm"):
        place(fixture(), key, "entry", {})
    result = place(fixture(), key, "entry", {}, replace_existing=True)
    assert result["views"][0]["cards"][0]["pages"][0]["card"]["config_entry"] == "entry"


def test_native_section_and_panel_keep_existing_cards():
    result = place(fixture(), "view:1", "entry", {})
    assert result["views"][1]["sections"][0]["cards"][0]["grid_options"]["columns"] == "full"
    before = {"views": [{"type": "panel", "cards": [{"type": "markdown"}]}]}
    result = place(before, "view:0", "entry", {})
    assert result["views"][0]["cards"][0]["cards"][0] == before["views"][0]["cards"][0]
    with pytest.raises(ValueError):
        place(before, "view:99", "entry", {})
    assert fingerprint(before) == fingerprint(deepcopy(before))
