# Sigenergy TC 0.2.13 · Public Beta

## Changes

- **Dashboard placement:** the card's Add to dashboard flow warns before replacing a card in an occupied custom-menu slot. The replacement checkbox starts unticked and resets when the destination changes. Ordinary page placement continues to add beside existing content. Dashboard comparison, backup and readback checks remain in place.
- **Network privacy:** native network details require an HA administrator, including cached reads. Known credential fields such as `pwd`, `wifiPwd`, passwords and tokens are removed recursively. Other read-only presets keep their existing access rules.
- **Marketplace installation:** Sigenergy TC is now accepted into the default catalogue. Search for it directly in Marketplace, built into HA 2026.11 and later, or HACS on supported older HA. The README uses the native Marketplace badge with a compatible redirect for both. Custom-repository and manual ZIP steps remain available as fallbacks. Updates, forecast setup and dashboard instructions use the current terminology.

These changes address the follow-up notes in the [catalogue approval](https://github.com/hacs/default/pull/13854). They do not change plant commands or redesign the dashboard.

## Validation

632 backend tests and 449 frontend tests pass, with Ruff. Regressions exercise administrator/non-administrator network access before and after cache population, recursive credential filtering, refused replacement without explicit consent, the in-card warning and checkbox reset, and preservation of existing page content. Official Hassfest and HACS checks must pass before publication. These checks do not perform live plant commands.

Isolated HA Test on the minimum supported Core 2026.10.1 loaded the candidate with a synthetic entry and locked writes. Chrome verified the actual replacement warning and consent reset at desktop and phone widths. No dashboard was saved during this visual check. The real plant connection remained disabled, and Test was stopped after restoring its synthetic entry to disabled. See [release validation](acceptance.md).

## Install or update

New installation: open **Settings → Marketplace**, search for **Sigenergy TC**, select **Install** and follow the [installation guide](installation.md). On HA 2026.10.1–2026.10.x, search in HACS and use **Download**.

Existing users: finish active TC commands and temporary charging overrides, install **0.2.13** from **Settings → Updates** (or update in older HACS), restart Home Assistant and refresh each browser/tablet or Companion App. Keep the existing integration entry and dashboard. Manual installation uses `sigenergy-tc-0.2.13.zip` and `SHA256SUMS.txt` from this release.
