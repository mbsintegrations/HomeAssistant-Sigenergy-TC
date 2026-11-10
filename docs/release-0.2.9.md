# Sigenergy TC 0.2.9 · Public Beta

This is the first public Beta. Install or update from the GitHub repository through HACS as a custom integration. A ZIP and SHA-256 checksum are also available on the release page.

## Changes

- Starting an AC charger in PV Surplus mode can offer **Temporary Fast Charging**, **Wait for solar** or **Cancel**. TC preserves the original Surplus settings and attempts to restore them after the session. A persistent session record supports recovery after an HA restart without automatically replaying Start or Stop.
- The dashboard displays the AC session's waiting, charging and restoration status.
- The overview now uses plant-level battery SOC even when separate battery module sensors are present.
- Chart choices persist across reloads on embedded dashboards. Selected charts remain visible when history is empty, and PV string charts support explicit Recorder sensor mappings.

## Verification and open work

The owner confirmed charger operation, battery Hold and grid transfer on installed hardware. End-to-end automatic AC Surplus restoration and native strategy and configuration writes require separate physical verification. The DC temporary-mode override and state-aware AC/DC buttons remain tracked in [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16).

The temporary AC mode is managed by Home Assistant and needs HA and Cloud connectivity to restore. You can recover the original mode in mySigen if required. See the [control and recovery guide](controls-and-recovery.md) and [validation scope](acceptance.md).

## Install or update

- New installation: [add the custom repository in HACS or install the ZIP](installation.md).
- Update: finish active commands and charging overrides, download **0.2.9** in HACS, restart HA, and reload dashboard clients. Keep your existing integration entry and dashboard.
- Place the full dashboard or individual cards using [dashboard placement](dashboard-embedding.md). Set up forecast sources through [installation and setup](installation.md#forecasts).
- Report defects and feature requests through [GitHub Issues](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues).
