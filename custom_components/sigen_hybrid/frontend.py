"""Serve and register the bundled dashboard without replacing owner resources."""

from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA

from .const import DOMAIN


async def async_register_frontend(hass):
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                f"/{DOMAIN}/{filename}",
                str(Path(__file__).parent / "frontend" / filename),
                cache_headers=False,
            )
            for filename in (
                "sigen-hybrid-card.js",
                "sigen-hybrid-navigation.js",
                "sigen-hybrid-details.js",
                "sigen-hybrid-charts.js",
                "sigen-hybrid-settings.js",
                "sigen-hybrid-widgets.js",
                "sigen-hybrid-energy.js",
                "sigen-hybrid-photo.js",
                "sigen-hybrid-overview.js",
                "sigen-hybrid-sankey.js",
                "sigen-hybrid-house.js",
                "sigen-hybrid-devices.js",
                "assets/overview-house-day-v1.webp",
                "assets/overview-house-night-v1.webp",
            )
        ]
    )
    dashboard = hass.data.get(LOVELACE_DATA)
    if dashboard is not None and dashboard.resource_mode == "storage":
        resources = dashboard.resources
        await resources.async_get_info()
        if not any("sigen-hybrid-card.js" in item.get("url", "") for item in resources.async_items()):
            await resources.async_create_item({"url": f"/{DOMAIN}/sigen-hybrid-card.js", "res_type": "module"})
