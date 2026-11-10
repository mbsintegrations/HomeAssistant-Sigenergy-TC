# Sigenergy TC 0.2.10 · Public Beta

## Changes

- **AC and DC charger controls follow live status.** Start is disabled while charging and Stop is disabled while idle. Stop stays available for a waiting session that TC started. Stale or unbound telemetry is treated as unknown.
- **Temporary Fast Charging is available for DC chargers in PV Surplus mode.** TC changes the charging mode, retains the other reported DC settings, and restores the original mode when the session ends. The AC and DC sessions have separate recovery records. Restoration requires Home Assistant and Cloud connectivity.
- **TC rechecks the charger before dispatch.** It blocks duplicate starts and compares the current settings against the preview before changing the mode. Restoration preserves newer owner changes.

## Validation

The owner reported completing the live AC/DC charger check and approved release. Automated checks cover charger button behavior, waiting-session cancellation, and temporary mode restoration and recovery. See the [acceptance notes](acceptance.md) and [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16).

## Install or update

Finish any active charging override before updating. Download **0.2.10** in HACS, restart Home Assistant, and refresh the dashboard. For manual installation, download the ZIP and checksum from the release assets and follow the [installation guide](installation.md).
