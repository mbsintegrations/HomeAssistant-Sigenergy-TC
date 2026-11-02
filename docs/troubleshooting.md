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

Update the integration and reload the dashboard to obtain the current frontend imports. The full drop-in measures the host area, and Photo House preserves the artwork/label ratio. On smaller spaces, scroll inside the drop-in to reach all controls. The supported custom shell should pass its content height using `--sigen-embedded-height`; an old shell that does not render embedded cards needs its own adapter update.

## Backend updated but the old interface remains

Earlier versions retained the unversioned registered TC resource, allowing an open tablet or browser to keep the previous module graph. Version 0.2.4 and later upgrade their own resource URL automatically. Restart HA after HACS updates, then fully reload the web view. In HA dashboard Resources, the TC URL should match the installed version, for example `?v=0.2.7`. Do not add a second copy of the same module.

## Installed chargers missing from Photo House

Version 0.2.3 hid charger labels when no instantaneous power entity was discovered, even when the Cloud inventory listed the device. Version 0.2.4 separates installed status from telemetry availability. AC/DC labels and cables use actual inventory; missing power stays unknown. Check the discovered inventory and any explicit null/exclusion mapping if a charger remains absent.

## A strategy exists in mySigen but not in TC

Update to 0.2.7 or later, restart HA and reload the dashboard. Open Personal strategies and check **Sigenergy plant strategies**, which is separate from **Home Assistant schedules**. Native Personal Strategies are a different Cloud collection from custom operating profiles. TC reads them with the configured Cloud login; no browser session is required. Failed reads remain errors, and an empty list applies only to the active operating mode.

## A DC charger uses V2X but the charging-mode popup is blank

Version 0.2.7 reads an existing native DC mode 2 as V2X and keeps it selected instead of silently selecting Fast charging. V2X dispatch is not implemented by the ordinary charging-mode writer.
