# Sigenergy TC 0.2.11 · Public Beta

## Changes

- Modbus monitoring reconnects after a failed startup connection or later TCP disconnection. Explicit reconnect attempts are paced, and write commands retain their existing single-dispatch behavior.
- Cloud battery capacity and device topology refresh every 15 minutes through the configured account. Newly installed battery modules receive their own HA entities automatically. Confirmed topology changes remove old modules from the current device list while preserving existing entity history.
- Cloud telemetry refreshes every minute while local monitoring is unavailable, then returns to the normal interval after local recovery. Detailed device reads retain their normal interval and the account request gate continues to enforce pacing and cooldowns.
- HACS catalogue validation correctly identifies the integration after the artwork metadata file was renamed. A regression test prevents another auxiliary manifest from blocking discovery.

## Update

Download **0.2.11** in HACS, restart Home Assistant, and refresh the dashboard. Existing configuration and dashboards are reused. For a manual update, download `sigenergy-tc-0.2.11.zip` and `SHA256SUMS.txt` from this release and follow the [installation guide](installation.md#manual-installation).

## Validation

Backend regressions cover recovery from an initially disconnected Modbus client, bounded reconnect attempts, unchanged write dispatch, changing battery inventory and capacity, invalid metadata, and Cloud fallback when local monitoring fails and recovers. The complete backend/frontend suites, Ruff, and official HACS/Hassfest checks run for this release.

Live diagnostics used read-only requests. The existing installation recovered after a TC reload and returned the expanded battery inventory, aggregate capacity and matching local SOC. Automated tests validate the new recovery paths with synthetic failures. See [release validation](acceptance.md).
