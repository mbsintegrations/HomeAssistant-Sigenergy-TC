# Troubleshooting

| Symptom | Check |
| --- | --- |
| Integration not in picker | Correct `custom_components/sigen_hybrid` directory; restart; minimum HA version; installation log |
| Card not in picker | Refresh browser; check exactly one JS module resource; storage registration versus YAML resource configuration |
| Wrong/missing entities | Select the correct entry in the visual editor; verify entity-registry mapping and disabled entities; do not guess renamed entity IDs |
| Modbus unavailable | Installer enablement, actual host/port/unit, LAN reachability, sole/shared-client declaration and transport trace |
| Cloud login failed | Region/account/access and safe error category; failure is not automatically proof of a wrong password |
| Too many users/429 | Stop repeated reloads/logins; allow cooldown; inspect other native app sessions; keep Modbus readings active |
| Only one forecast badge | Check each provider's current valid data; missing/stale sources are excluded from that total even if averaging remains selected |
| Daily total differs | Confirm same calendar/time zone, source, baseline and refresh time; a new HA recorder integral is not the cloud's whole-day energy |
| Slow/missing charts | Selected common period, source connectivity, provider retention, request cooldown, cached versus missing data and Recorder retention |
| Command unavailable | Owner control enablement; advertised capability; cloud connectivity; native state; exact device identity and installer limits |
| Command uncertain/recovery pending | Do not repeat blindly. Inspect native state and follow the recovery guide |
| Strategy waiting | Master/rule enabled, current start-day window, fresh SOC and strict threshold; competing priorities/manual owner override |
| Strategy paused | Owner changes were preserved. Review them before deliberately resuming scheduling |

For a report include integration/HA version, connection combination, sanitized diagnostics, expected/actual behavior and a cropped screenshot. Never post passwords, tokens, private journals, addresses or device serials. Do not delete a recovery journal or raise installer limits to clear an error. [Security reports](../SECURITY.md).

## Daily energy is missing after first installation

Modbus cumulative meters cannot establish energy since midnight when TC is first installed during the day. With Cloud connected, TC now reads the measured current-day bucket from its shared calendar-history cache, at most once per 15 minutes. It does not integrate sampled power, fabricate zero, or subtract an asynchronous Cloud total from a local lifetime meter. Established local daily counters take priority. Cloud data retains its own observation time and expires independently of live-power refreshes.

Local-only installations need a continuous midnight crossing or an explicitly verified same-plant daily/cumulative migration pair. An overnight gap cannot recover a missing baseline. Missing or predicted Cloud buckets remain unavailable; check the Cloud connection and chart history. HA Recorder cannot reconstruct a full day that it did not record.

## Tablet headers or house labels are cut off

Update the integration and reload the dashboard to obtain the 0.2.3 frontend imports. The full drop-in measures the host area, and Photo House preserves the artwork/label ratio. On smaller spaces, scroll inside the drop-in to reach all controls. The supported custom shell should pass its content height using `--sigen-embedded-height`; an old shell that does not render embedded cards needs its own adapter update.
