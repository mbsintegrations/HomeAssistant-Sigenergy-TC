# Installation, setup, upgrades and removal

**Invitation-only Alpha. Do not install unless invited by MBS Integrations.** Minimum Home Assistant: 2026.10.1.

## Before installation

Create a restorable HA backup. Record current mySigen mode, SOC charge/discharge/backup thresholds, export restrictions and gateway state. Retain access to mySigen on another device. Review competing controllers and schedules before enabling writes; a second integration must not fight this one. Monitoring can coexist where the plant firmware supports the additional Modbus client, but this needs observation on the actual system.

## HACS

Add `https://github.com/mbsintegrations/Sigenergy-TC` under HACS custom repositories, category Integration. Download the release, restart HA and add **Sigenergy TC** in Devices & services. A GitHub account/HACS login is separate from the plant's mySigen login. There is no NBI application step.

## Manual installation

Download `sigenergy-tc-0.1.0.zip` and `SHA256SUMS.txt` from the matching release. Verify the SHA-256 before extraction. Merge the ZIP's `custom_components/sigen_hybrid` into HA's `config/custom_components/sigen_hybrid`; avoid an extra nested folder. Restart HA and use the native setup dialog. Do not copy the whole repository into `custom_components`.

## Connections

- **Modbus:** enter the actual inverter/plant host and port. The installer must enable Modbus on the plant. Declare whether this is the sole client or an additional read-only client. Shared mode enforces read-only access and slower polling. Do not guess device unit IDs or change installer settings to get a connection.
- **Cloud:** select the correct region and enter the owner's mySigen username/password, accepting optional unofficial app-interface use. Login discovers the account plant. Ambiguous identity is rejected rather than selecting an arbitrary plant. Reauthentication uses the native HA flow.
- **Both:** local measurements are preferred where available and fresh; cloud adds supported settings/history. A failed source does not deliberately stop the other. Controls needing Cloud become temporarily unavailable during an outage.

The new-entry wizard exposes owner control enablement and limits. Existing installations are not silently enabled by an upgrade. Modbus-only mode cannot unlock cloud operating modes or timed local writes. No hardware write is required to finish setup.

## Forecasts

Install/configure a provider integration first: built-in [Forecast.Solar](https://www.home-assistant.io/integrations/forecast_solar/), [Open-Meteo Solar Forecast](https://github.com/rany2/ha-open-meteo-solar-forecast), [Solcast](https://github.com/BJReplay/ha-solcast-solar), or [Volcast](https://github.com/volter-labs/volcast-ha-integration). Provider account/pricing eligibility is the provider's responsibility.

Use the forecast popup or Configure → Forecast to select loaded sources. Average at most two forecasts describing the same panel installation. Missing source values are excluded, not replaced with zero. With only one valid source the result is that source and its badge; the provider settings retain the selected sources. The integration consumes cached forecast data rather than forcing extra provider refreshes.

## Dashboard

Storage-mode Lovelace receives `/sigen_hybrid/sigen-hybrid-card.js` automatically if no existing Sigenergy TC card resource is registered. Existing resource URLs are preserved. If using YAML resources, add that path as `type: module` yourself. Do not register both a copied `/local/` module and the bundled module. Refresh the browser after an upgrade.

Add a panel view or use an ordinary Sections view. Pick the integration in the card editor. A single detected entry is selected automatically by the card stub; multiple plants require an explicit choice. Configure weather and appearance there. The default main scene is Photo House. No card-mod or third-party chart library is required. See [cards](cards.md) and [embedding](dashboard-embedding.md).

## Updates

Read the release notes; take a backup; release active commands before restarting or updating; download in HACS; restart HA; refresh clients. Keep previous releases and backups available. The domain remains `sigen_hybrid` to preserve entity identities despite the product rename. Update this repository's documentation and screenshot gallery when behavior changes.

## Removal

Disable scheduled strategies and release any active TC command while Cloud is available. Verify the native plant settings in mySigen. Disable/remove the integration entry, remove its dashboard cards/resource if unused, then remove the package in HACS and restart. Do not remove the original integration or OCPP configuration as part of this process. If a command cannot be released, use the [recovery procedure](controls-and-recovery.md) first. Saved HA history follows HA Recorder retention; uninstalling software is not a history migration.
