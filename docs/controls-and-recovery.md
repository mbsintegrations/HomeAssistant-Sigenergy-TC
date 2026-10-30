# Controls and recovery

**Invitation-only Alpha. Physical plant acceptance remains the invited owner's task.** This release contains real control handlers, not simulated success responses. Test and Demo remain separate from real connections.

## Commands

| Control | Behavior | Requirement |
| --- | --- | --- |
| Charge | Battery charging, limited by owner/device power and SOC ceiling | Enabled local or Cloud control |
| Discharge to Home | Cloud blocks battery export independently; local temporarily caps the entire grid export point at zero | Enabled control and fresh native metadata/sensor |
| Discharge to Grid | Battery discharge with battery export permitted | Explicit export approval and no blocking installer restriction |
| Hold battery | Cloud native hold; local zero charge/discharge power bounds | Enabled local or Cloud control |
| Self-consumption | Timed self-consumption override | Enabled local or Cloud control |
| Mode | Selects the exact mode/profile advertised by this plant | Cloud; feed-in mode also needs export approval |
| On/Off Grid | Requests gateway switch and checks gateway readback | Advertised supported gateway, valid state and owner enablement |
| AC/DC start/stop | Targets an exact discovered charger serial | Advertised installed device; unsupported V2X state is rejected |
| SOC limits | Owner charge/discharge/backup/peak-shaving bounds | Configured safety envelope; JA12 is preserved |
| Additional owner settings | Power limits, backup reserve, priorities, peak shaving and charger modes | [Owner-setting reference](owner-settings.md); complete firmware readback |

The popup titles distinguish **Discharge Battery to Home Load** from **Discharge Battery to Grid**. Home-discharge is a power limit, not a guarantee that the battery always outputs that value; home demand, solar, grid restrictions and plant firmware still govern actual flow. Grid-discharge requests likewise do not override installer export caps or guarantee export during household demand.

Manual durations are whole minutes **1–1440**, with 30/60/90/120/180-minute presets and custom entry. System power choices respect the configured owner and discovered device limits; custom power must stay within that envelope. Hold and self-consumption do not take arbitrary power setpoints.

## Before a real test

Record the current mySigen mode, battery SOC thresholds, export settings, gateway connection and charger state. Keep native app/web access available. Review other automation writers. Choose conservative finite limits appropriate to the installation. Export approval must reflect the actual site's permission; the integration must not be used to bypass installer/grid restrictions. Do not use gateway switching as a connectivity test.

## Command lifecycle

An interactive command requires an authenticated HA administrator. A trusted HA automation uses the automation control path and cannot preempt an active owner override. Each request is bound to one configured plant and exact discovered devices; arbitrary endpoint/register access is not exposed.

The backend validates fresh telemetry and native permissions, writes original/requested settings to an entry-owned durable HA Store journal, sends a closed native command, then checks fresh readback. Jobs report queued/running/confirmed/failed/uncertain outcomes. A successful HTTP response alone is not treated as physical proof. Some native responses omit power readback; mode/expiry confirmation must not be described as verified power delivery.

Cloud timed commands use the plant's native expiry. Explicitly enabled local commands use an HA-managed expiry, not a device watchdog. Local duration starts when remote EMS is activated. If HA stops, local control may continue within the native SOC/power bounds until HA returns or the owner restores native operation. Battery levels and export restrictions temporarily changed by TC also require recovery to restore their previous values; even native cloud expiry does not restore every auxiliary setting.

Local activation verifies the primary inverter serial, a connected grid sensor, running/on-grid state and current SOC. It refuses an already-active remote EMS controller. A fresh owner request may change transport only after the previous TC command has been released; an uncertain command is never replayed on another connection. Cloud is preferred for battery discharge when available, because it can preserve independent PV export.

Combined control first checks that the physical Modbus inverter serial belongs to the selected Cloud plant. The verified pairing is stored locally and rechecked if the account, plant, endpoint or inverter changes; a saved matching pairing allows local operation during an internet outage. Without verified pairing, Cloud control uses its own fresh plant telemetry. Request IDs cannot be replayed through the other transport.

The journal survives HA restarts. Recovery compares current settings with the values TC actually wrote before restoring anything. New owner/installer changes are preserved. Lost responses are treated as uncertain, never blindly replayed. A superseding owner change durably pauses the TC scheduler. Charger recovery may stop a session; it never blindly restarts an old session.

## Stop and restore

1. Disable personal scheduling and competing writers.
2. Use the TC active-command cancellation action, or `sigen_hybrid.cancel_manual_control` for the selected integration entry. Wait for its job result.
3. Verify battery flow, mode, SOC/export bounds and gateway/charger state in mySigen.
4. If HA/cloud recovery is unavailable, cancel native Instant Manual Control in mySigen. Select the previously recorded mode and restore the recorded owner SOC/export values through the native app/web interface. Return a gateway only to its intended safe state; never alter installer/grid protection settings.
5. Restore HA/cloud access, review the journal/control status and resolve uncertainty before scheduling resumes. Preserve the original journal; do not delete it to make an error disappear.

Disabling a connection or control through TC options first attempts to release TC's active lease. If safe release is not confirmed, the option change aborts rather than discarding its recovery path. HA shutdown cannot guarantee a final provider operation. Keep HA running during local timed tests and retain the private journal for recovery.

## HA actions

Use Developer tools → Actions and the integration's native action fields. `manual_control` accepts the integration entry, `mode`, optional `power_kw`, `duration_minutes`, `request_id`, source and `dry_run`. `owner_setting` accepts only the closed supported setting names and validates their structured value. `cancel_manual_control` releases only TC-owned state. `preview_plan` is advisory and sends no plant command. Start with previews when inspecting parameters; deliberately use `dry_run: false` for owner-approved real testing.

Do not copy another plant's entry ID or serial. Diagnostics and journals are different: diagnostics are allowlisted; private journal files can contain device identities and must not be posted publicly.
