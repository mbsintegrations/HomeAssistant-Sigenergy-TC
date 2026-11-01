"""Explicit, admin-only placement into an existing editable dashboard."""

import json
from copy import deepcopy
from hashlib import sha256


def fingerprint(config):
    return sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def targets(config):
    """Address existing pages and nested custom menus without changing them."""
    result = {}

    def visit(cards, path, title):
        for index, card in enumerate(cards if isinstance(cards, list) else []):
            if not isinstance(card, dict):
                continue
            at = [*path, index]
            if card.get("type") == "custom:taba7-dashboard-shell":
                for page, item in enumerate(card.get("pages", [])):
                    result[f"shell:{'.'.join(map(str, at))}:{page}"] = {
                        "label": f"Custom menu · {title} / {item.get('name', page + 1)}", "path": at,
                        "page": page, "occupied": bool(item.get("card")),
                    }
            visit(card.get("cards"), [*at, "cards"], title)

    for index, view in enumerate(config.get("views", [])):
        title = view.get("title", view.get("path", f"Page {index + 1}"))
        result[f"view:{index}"] = {"label": f"Page · {title}", "index": index}
        visit(view.get("cards"), ["views", index, "cards"], title)
        for section, item in enumerate(view.get("sections", [])):
            visit(item.get("cards"), ["views", index, "sections", section, "cards"], title)
    return result


def place(config, key, entry_id, preferences, *, replace_existing=False):
    target = targets(config).get(key)
    if not target or config.get("strategy"):
        raise ValueError("Destination changed")
    result = deepcopy(config)
    card = {"type": "custom:sigen-hybrid-card", "config_entry": entry_id, "view": "overview",
            "embedded": True, "main_display": preferences.get("main_display", "photo"),
            "appearance": preferences.get("appearance", "auto")}
    if "page" in target:
        if target["occupied"] and not replace_existing:
            raise ValueError("Confirm replacement of the existing menu card")
        node = result
        for part in target["path"]:
            node = node[part]
        node["pages"][target["page"]]["card"] = {**card, "embed_mode": "shell"}
    else:
        view = result["views"][target["index"]]
        card["embed_mode"] = "card"
        if view.get("type") == "sections" or "sections" in view:
            view.setdefault("sections", []).append({"type": "grid", "cards": [{**card, "grid_options": {"columns": "full", "rows": "auto"}}]})
        elif view.get("type") == "panel" and view.get("cards"):
            view["cards"] = [{"type": "vertical-stack", "cards": [*view["cards"], card]}]
        else:
            view.setdefault("cards", []).append(card)
    return result


async def dashboards(hass):
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from homeassistant.helpers.http import current_request

    # HA options-flow contexts do not contain user_id. Resolve the actual
    # authenticated request; never accept an identity supplied as form data.
    request = current_request.get()
    request_user = request.get("hass_user") if request is not None else None
    user_id = request_user.id if request_user is not None else None
    user = await hass.auth.async_get_user(user_id) if user_id else None
    if user is None or not user.is_admin:
        raise PermissionError("Dashboard placement requires an administrator")
    data = hass.data.get(LOVELACE_DATA)
    result = {}
    for path, dashboard in getattr(data, "dashboards", {}).items():
        if dashboard.mode != "storage":
            continue
        try:
            config = await dashboard.async_load(False)
            if not config.get("strategy") and isinstance(config.get("views"), list):
                result[path or "lovelace"] = (dashboard, deepcopy(config))
        except Exception:
            continue
    return result


async def save(hass, dashboard, original, changed, entry_id):
    """Persist rollback before saving, reject concurrent edits and verify readback."""
    from homeassistant.helpers.storage import Store

    if fingerprint(await dashboard.async_load(False)) != fingerprint(original):
        raise ValueError("Dashboard changed; select the destination again")
    store = Store(hass, 1, f"sigen_hybrid_dashboard_backups_{entry_id}")
    previous = await store.async_load() or []
    await store.async_save([*previous[-4:], {"url_path": dashboard.url_path, "before": original, "after": changed}])
    # Recheck after the backup await as another editor may have saved meanwhile.
    if fingerprint(await dashboard.async_load(False)) != fingerprint(original):
        raise ValueError("Dashboard changed; select the destination again")
    await dashboard.async_save(changed)
    if fingerprint(await dashboard.async_load(False)) != fingerprint(changed):
        raise ValueError("Dashboard readback did not match; inspect before retrying")
