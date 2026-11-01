# Changelog

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
