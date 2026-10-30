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
