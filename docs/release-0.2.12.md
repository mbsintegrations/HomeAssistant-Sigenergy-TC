# Sigenergy TC 0.2.12 · Public Beta

## Fix

The tariff-planning preview now resolves the selected timezone with Home Assistant's asynchronous timezone helper before building a tariff plan. The plan stores that timezone object and reuses it for every price lookup. An uncached timezone no longer requires a timezone-file read on Home Assistant's event loop. Unknown or malformed timezone names use the existing plan-validation error response.

This addresses the [HACS review request](https://github.com/hacs/default/pull/13854#pullrequestreview-6074772887). The preview remains advisory and sends no plant commands. Existing dashboard layouts, control permissions and plant settings are preserved.

## Validation

625 backend tests and 447 frontend tests pass, with Ruff. New tests exercise the registered preview service with uncached zones, verify one asynchronous resolution and reuse across all 48 half-hour slots, cover both daylight-saving transitions, and reject invalid timezone input before forecast/planning work. Official Hassfest/HACS validation runs before publication.

Isolated HA Test on Core 2026.10.1 loaded the candidate and served its current frontend module. The real preview service produced advisory plans with two cold timezone names and a cached Open-Meteo forecast, then rejected an unknown timezone. No Sigenergy blocking-call warning was recorded. Its real plant entry stayed disabled, writes stayed locked, and temporary Test preferences were restored. See [release validation](acceptance.md).

## Update

Finish active TC commands and temporary charging overrides, download **0.2.12** in HACS, restart Home Assistant, and refresh the browser/tablet or Companion App. Keep your existing integration entry and dashboard. Manual installation uses the attached `sigenergy-tc-0.2.12.zip` and `SHA256SUMS.txt`; follow the [installation guide](installation.md#manual-installation).

The existing HACS catalogue submission is re-requested for review after publication. Until accepted, add this repository as a custom HACS integration as described in the installation guide.
