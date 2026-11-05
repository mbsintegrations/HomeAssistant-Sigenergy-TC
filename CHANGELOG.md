# Changelog

## Unreleased

- Offer a temporary Fast Charging confirmation when starting an AC charger configured for PV Surplus. Wait for solar and Cancel leave it untouched.
- Restore the previous Surplus settings after the observed session ends, preserving the owner's limits and newer mySigen changes. Persist recovery across HA restarts without replaying charger commands.
- Show waiting, charging and restoration status beside AC controls. Automatic restoration requires HA and Cloud online; the lease is managed by HA, not a hardware timer. See [next-release testing](docs/NEXT_RELEASE.md) and [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16).

## 0.2.8

Documentation follow-up: explicit HACS setup, optional dual-forecast setup, existing-page placement, separate dashboard creation, compatible custom-menu drop-in and individual-card instructions.

Released 2 November 2026. Invitation-only Alpha. [Release and upgrade notes](docs/release-0.2.8.md).

- Add New, Change, Rename and Delete actions for native mySigen Personal Strategies, separate from TC-owned HA schedules.
- Use the native personalization assistant for rule creation/changes, including explicit reviews, returned proposal confirmation and bounded response polling. Rename/delete use direct native requests with fresh readback.
- Bind previews/conversations to the HA administrator and configured plant. Reject stale rule revisions and foreign-plant responses; consume mutation requests before dispatch to prevent automatic replay after timeout/reconnection.
- Save a private pre-change rule snapshot, retain existing scalar/manual controls and add desktop/tablet/phone strategy interaction coverage. Document remaining supervised plant-write acceptance separately from software/read-only checks.

## 0.2.7

- Read existing mySigen Personal Strategies through the configured Cloud account, separately from TC's HA schedules. Display native names, conditions and actions without activating or duplicating rules.
- Add on-demand, plant/device-bound reads for saved tariff periods, operating profiles, preheating, indicator channels, inverter/AC networking, charger schedules/records/additional settings, OCPP/cards, backup history/events, energy saving, aggregator allocation and service-provider information. Preserve the accepted overview layout and working connection diagnostics.
- Reuse the account session, request pacing and cooldowns; cache optional configuration for five minutes. Give interactive settings reads independent locks so they do not wait for an entire optional device-refresh burst.
- Preserve unset disabled grid limits as unset instead of rejecting them or replacing them with zero. Read local settings even when local writes are disabled, without claiming control ownership.
- Read an existing DC V2X charging mode and keep it selected in the interface. Do not enable V2X dispatch through the ordinary charging-mode writer. Display grouped solar priorities without sending an unverified flat update.
- Retain charger-history date filters and add native history pagination. Distinguish unknown, failed, disabled and empty settings. Keep native preset collections read-only where a writer has not been implemented; document the exact coverage in the native-settings guide.
- Add regression tests, desktop/tablet/phone preset-dialog checks and synthetic screenshots. Existing write/export permissions and dashboards are preserved; no new browser or API-key setup is required.

## 0.2.6

- Read AC/DC connection states and instantaneous charging power from configured local devices. Reuse unambiguous Sigen Local Modbus unit configuration only on the same endpoint; otherwise accept explicit optional charger unit IDs. No unit scanning, assumed addresses or extra TCP client is added.
- Show charger connection/charging/fault states consistently in Photo House, House, Flow and phone tiles. Zero watts does not mean disconnected; unsupported or missing state remains unknown.
- Add the temporary override action, remaining duration and Cancel to the existing Instant manual control header, with the active action highlighted. Show checking/applying/releasing/recovery states independently of the normal operating mode.
- Recover override metadata from its durable journal after restart, showing verification pending until identity/readback reconciliation confirms it. A confirmed Hold distinguishes fresh near-zero battery power from an old reading or continued battery movement.
- Prioritize local commands and restoration between existing paced requests. Group adjacent allowlisted reads and reuse a checked write's immediate fresh readback. Preserve serial checks before writes, write-ahead recovery, owner-change checks, one-second pacing and no blind retry.
- Refresh monitoring after a confirmed local command. Reduce synthetic Hold transaction traffic from 62 requests to 49 with the same five writes; this is a software comparison, not a live timing guarantee.
- Extend backend, frontend and active-override resize coverage; update documentation and synthetic screenshots. Existing plant settings, permissions and dashboards are preserved.

## 0.2.5

- Publish essential Cloud readings and discovered AC/DC presence before slower optional battery-module reads. Collect daily history before those optional reads, and preserve completed observations when a later request fails.
- Keep a measured daily history total when the live endpoint returns an absent value; preserve real zero values and each observation's freshness and local date.
- Restore plant-bound device inventory, observed operating mode and fresh same-day energy after restart, before Cloud reconnects. Cached observations never restore permissions or authorize commands.
- Display the actual provider mode label, including Maximum Self-Powered, even when the native writable selection is temporarily unavailable.
- Preserve Cloud cooldowns across HA restarts, honor Retry-After, and add sanitized failure diagnostics. Undocumented application codes alone are no longer labelled rate limits. The six-second request spacing is a client policy, not a published Sigenergy quota.
- Fix overlapping summary panels after shrinking an embedded dashboard and strengthen shrink/expand browser assertions. Preserve the accepted scenes, controls, typography and colors.
- Update chart source requirements, upgrade instructions and validation boundaries. Existing write/export preferences and dashboards are preserved.

## 0.2.4

- Version and upgrade the registered frontend resource automatically, retaining its resource ID and leaving other cards untouched. This prevents an updated backend from retaining the previous JavaScript module graph on tablets and browsers.
- Keep installed AC/DC chargers visible from the actual inventory even when a power sensor is not bound. Missing readings remain unknown; explicit entity exclusions are respected. Add the previously missing conditional charger connection paths and detail links to Photo House.
- Remove blurred image padding. Preserve the photo proportions and align its leaders, installed-device labels and flow paths within the responsive scene.
- Fit the complete landscape overview below host headers and beside dashboard sidebars. Reflow daily totals into three columns on compact landscape layouts and retain reachable controls in the same composition. Phones and portrait layouts keep their readable scrolling layout.
- Test both chargers without power bindings, resource upgrades, and whole-layout visibility across 44 browser layout cases plus 12 resize checks.

## 0.2.3

- Fit embedded dashboards to their host space below headers. Keep Photo House artwork, flow lines and labels on one aspect ratio; preserve charger details when resizing and use readable tiles on narrower tablets. Scroll within the drop-in where the available space cannot contain every control.
- Add Configure → Add to dashboard for existing editable pages and supported custom-shell menus, with explicit replacement confirmation, rollback storage, concurrency checks and verified readback. No starter dashboard or YAML editing is required.
- Supply measured first-day daily energy from Cloud calendar buckets through the shared history cache. Prefer established local daily counters; never infer a midnight baseline from asynchronous Cloud/Modbus readings.
- Correct setup review permissions and export text to match selected preferences.
- Extend browser regression coverage to embedded header/resize cases across all three scenes; update documentation and screenshots.

## 0.2.2

- Replace the primary inverter unit-ID slider with an integer number box.
- Use verified plant power limits automatically during new setup; custom charge/discharge caps are optional follow-up fields. Preserve existing custom caps.
- Resolve automatic power from fresh readings for commands, strategies and advisory plans; never invent a rating from missing/unlimited metadata.
- Select up to two installed forecast providers and averaging during setup and in HA options, using the same saved source identities as the dashboard settings.
- Refresh stale local control evidence before previews; setup still sends no plant commands.

## 0.2.1

- Fix the short-height tablet sidebar: forecast, daily energy and battery/energy rings keep their full width rather than being squeezed into half-width boxes.
- Keep ring padding inside its width, prevent daily energy tiles escaping their card, and allow vertical scrolling on shorter landscape displays.
- Restore the forecast unit in the documentation fixture and replace affected screenshots. Add a real-browser layout regression check covering five desktop/tablet/phone sizes.
- Plant control behavior and permissions are unchanged.

## 0.2.0 — Invitation-only Alpha — 2026-10-30

**Do not install without an invitation from MBS Integrations.** Expanded functional control release; existing installations retain their previous enablement.

- Added opt-in local battery control with primary-inverter serial checks, native SOC/power bounds, connected-grid checks and durable HA-managed expiry/recovery.
- Added one command authority across local/cloud actors, explicit owner handover, duplicate protection and no blind fallback of an uncertain operation. Local work does not wait on a cloud polling lock.
- Added battery/PV power, backup reserve, grid power/current, priority, peak-shaving, charger mode and DC charging-limit handlers with closed native payloads and verified readback.
- Added live owner-setting forms, exact charger targeting, stale-edit revision checks and native setting documentation. Preserved the accepted dashboard layout and colors.
- Installer restrictions, site export approval, owner bounds and shared read-only connections remain enforced. A local home-only discharge caps all grid export at zero; cloud discharge can preserve separate PV export.

Modbus has no documented independent command expiry: keep HA running for local timed tests. Missing native firmware metadata prevents the affected control. Native charger schedules, V2X dispatch, firmware/installer operations and external AI execution are not implemented as working controls.

## 0.1.0 — Invitation-only Alpha — 2026-10-30

**Do not install without an invitation from MBS Integrations.** First public repository/HACS custom-repository testing release; no default-catalogue submission or community announcement.

- Native optional Modbus/Cloud setup and reauthentication, independent telemetry sources, source status, backoff, cached history and privacy-safe diagnostics.
- Responsive full dashboard, Photo House/House/Flow, day/night/weather, detail navigation and reusable light/dark cards and charts.
- Bound cloud manual battery commands and owner mode, grid, charger and SOC controls with durable recovery, compare-before-restore, native expiry and owner priority.
- Personal scheduling with SOC/time conditions, optional power limits, native guards, explicit master enable, DST/overnight handling and conflict detection.
- Real device inventory, no invented optimizers/modules on automatic setup; automatic bundled card registration preserving existing resources.
- Tariff/season editing, cached forecast providers and averaging up to two sources; advisory planning.
- Installation, control/recovery, compatibility, troubleshooting and screenshot documentation.

Physical command acceptance is pending invited live-system testing. Timed local EMS writes, external AI execution, direct Tigo discovery and unsupported native settings are not claimed as completed controls.
