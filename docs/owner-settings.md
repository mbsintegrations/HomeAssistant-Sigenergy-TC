# Owner settings in Alpha 0.2.0

These are real write handlers. The setup wizard enables supported control by the owner's choice; no plant command is sent during setup. Existing entries retain their previous write setting. Every write is checked against the actual connection, identity, owner bounds and firmware response. Missing hardware or incomplete native metadata prevents a command; it is not simulated.

Open **Settings → Energy settings** or the relevant charger popup. Values are read from the plant. **Apply** queues the operation; the control status reports confirmation or a failure needing attention. If the value changed in mySigen after opening the popup, reopen it before saving. Failed/uncertain writes are not blindly retried.

| Action setting | Value shape | Route |
| --- | --- | --- |
| `native_mode` | `{mode, profile_id}` from the advertised catalogue | Cloud |
| `grid_connection` | Boolean: true on-grid, false off-grid | Cloud gateway |
| `ac_charging`, `dc_charging` | Boolean start/stop; optional exact discovered `serial` | Cloud |
| `battery_levels` | `{charge_soc, discharge_soc, backup_soc, peak_shaving_soc}` | Local or cloud; local peak-shaving SOC remains null |
| `battery_power_limits` | `{charge_kw, discharge_kw}` | Local or cloud; null uses the configured owner power bound |
| `pv_power_limit` | `{limit_kw}` | Local or cloud; null clears the owner PV power cap |
| `backup_reserve` | `{soc}` | Local or cloud |
| `battery_export_block` | Boolean; true blocks battery export | Cloud; clearing needs export approval and installer permission |
| `grid_export_limit`, `grid_import_limit` | `{enabled, limit_kw}` | Cloud with installer ceiling; local-only may tighten the current cap |
| `grid_connection_current` | `{enabled, limit_a}` in amperes | Cloud with verified installer current ceiling |
| `discharge_priority`, `solar_priority` | `{order: [...]}` using exactly the returned destination identities | Cloud |
| `peak_shaving` | `{enabled, soc, slots: [{weekdays, start, end, power_kw}]}` | Cloud; weekdays use native Monday 1 through Sunday 7, times HH:MM |
| `ac_charge_mode`, `dc_charge_mode` | Full current mode settings with only intended fields changed | Cloud; AC fast 0/PV 1/AI 2, DC fast 0/PV 1/AI 3 |
| `dc_charge_settings` | `{power_kw, cutoff_soc}` within the charger rating | Cloud |

Charger-mode values contain `mode`, `battery_boost`, `cutoff_soc`, `grid_charging`, `max_grid_power_kw`, `discharge_power_kw` and `stop_discharging_soc`. Unavailable optional values stay null. Vehicle discharge power/SOC fields are preserved, not edited through a charging operation. This release does not implement V2X dispatch.

The HA action is `sigen_hybrid.owner_setting`. Supply your own `config_entry`, the setting name, value and unique `request_id`. It defaults to `dry_run: true`; deliberately set `dry_run: false` to execute. Interactive writes require an HA administrator. The popup also supplies `expected_revision` to reject stale edits. Never copy another plant's identifiers.

Example, after configuring appropriate owner limits:

```yaml
action: sigen_hybrid.owner_setting
data:
  config_entry: YOUR_ENTRY_ID
  setting: backup_reserve
  value:
    soc: 30
  request_id: reserve-test-001
  dry_run: false
```

Permanent owner-setting changes are committed after readback. They are not automatically undone when the popup closes. The private write-ahead journal records their previous values; retain it and your native mySigen settings record. Timed overrides have separate cancellation/restoration. See [controls and recovery](controls-and-recovery.md).

Native charger schedules, unsupported charger options, installer/grid-code settings, firmware operations and external AI execution remain outside the working control set. Local tariff edits and draft-only optional screens do not claim to upload a native Sigen plan.
