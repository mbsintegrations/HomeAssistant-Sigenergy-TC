# Architecture

`coordinator.py` keeps Modbus and Cloud reads independent. Serialized Modbus reads normalize grid positive as import and battery positive as charging. Native cumulative counters and durable daily baselines avoid substituting power integrals for full-day native energy totals. Cloud requests share pacing/cache/cooldown, and history uses the same authenticated client. Provider timestamps and retrieval timestamps remain distinguishable.

Forecast adapters consume existing HA integration caches and normalize interval energy. Up to two valid sources may be averaged. Tariff helpers validate price units, calendars, time zones and overlaps; the financial planner is advisory.

`controls.py` owns tracked jobs and serialized cloud control. `core/control_providers.py` has a closed native operation allowlist. `core/recovery.py` persists write-ahead state, verifies readback, handles uncertain responses and compares current settings before restoration. Owner changes are preserved. `core/control_session.py` composes bounded battery overrides and native expiry. Timed local Modbus EMS execution remains locked without verified device-side expiry.

`core/strategies.py` validates rules and local-time windows. `strategies.py` consumes the entry-bound native HA shared preference store and evaluates rules without idle cloud polling. Native HA administrator permission is required to change shared scheduling preferences. The runner cannot cancel a newer manual command and does not replay interrupted writes.

The bundled vanilla JavaScript custom card has modular scene, chart, settings, overview, device and navigation renderers. It registers once without replacing an existing owner resource. Sensor discovery uses exact config-entry/entity-registry identities. Real hardware inventory comes from explicitly advertised device identities/presence; demonstration fixtures remain outside real entry defaults.

No MBS credential relay, external command backend, NBI onboarding or MCP executor is required. Credentials remain in HA configuration storage; diagnostics are allowlisted. See [security](../SECURITY.md) and [controls/recovery](controls-and-recovery.md).
