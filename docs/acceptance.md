# Release validation

## 0.2.9 Beta

Live checks on an embedded dashboard confirmed plant-level battery percentage in the scene and battery ring with individual battery modules present. Chart selection persisted across a reload. PV Strings plotted two Recorder series mapped to the same inverter.

Live Home Assistant returned fresh Modbus and Cloud status, both configured forecast sources, Recorder and Cloud SOC history, and a tariff/forecast planning preview. Read-only checks covered the active operating mode, SOC limits, backup reserve, grid connection and export limit, AC/DC charge modes, DC charging limits, native profiles, tariffs, strategies, and both charger schedule lists. The live controller accepted dry runs for Hold, Charge, Discharge and Self-consumption. The AC session preview returned the existing charger mode.

The owner confirmed charger operation, battery Hold and grid transfer on their installed system. The separate end-to-end AC Surplus restoration, command expiry/cancel and native configuration writes are outside that report. DC temporary override and state-aware charger buttons remain tracked under [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16).

## 0.2.8 native strategy Alpha

590 backend and 443 frontend tests pass, with Ruff. Six browser cases exercise native strategy creation, editing, rename, delete, cancellation and proposal confirmation at desktop, tablet and phone sizes. The actual Cloud account returned saved native conversations and an informational assistant response using the ordinary configured account; fresh before/after reads showed unchanged plant strategies. Inert HA Test startup served the new strategy module and rejected native writes with control disabled. Supervised acceptance of real native strategy create/change/rename/delete writes is still pending. Release 0.2.8 makes these controls available for invited owner testing; the software checks and read-only account tests do not establish physical command acceptance. See the [release notes](release-0.2.8.md).

The validation workflow runs synthetic backend/frontend tests and official Hassfest/HACS checks. See the [live checks](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/actions/workflows/validate.yml), [Beta test guide](alpha-testing.md), and [capability matrix](compatibility.md).

Backend tests exercise transport errors, rate limits, partial acceptance/lost responses, restart recovery, immutable identities, owner priority, SOC/power bounds, expiry, export restrictions, DST/overnight scheduling, conflict detection and competing TC writers. Frontend tests exercise cards, charts, navigation, data normalization, availability, forms and control bindings. Browser examples check desktop, tablet and phone rendering without horizontal overflow or JavaScript errors.

HA Test validation keeps plant writes locked and checks native setup, service registration, module resources, independently running read sources and the optional notification blueprint. No software test or isolated readback proves real-world plant control. Physical verification is reported separately for each release.

## 0.2.5 regression verification

- Real-account isolated read-only testing verified the observed operating mode, measured daily totals, both installed chargers and battery-module collection. A restart restored inventory, mode and fresh daily observations before the first Cloud HTTP request.
- Backend regressions cover essential/optional refresh ordering, missing live fields versus valid history, real zeros, cache expiry, local midnight and cross-plant cache rejection. Request-gate tests cover persisted cooldowns, Retry-After, backoff and privacy-safe diagnostics.
- Browser checks cover 44 initial desktop/tablet/phone and embedded scene cases, plus 24 shrink/restore checks. Resize checks now assert panel overlap and tile containment, not only reachable controls.
- Owner-command contract and failure/recovery tests run against synthetic transports. No plant control commands were sent in this read-only validation. Actual command acceptance remains an invited Alpha hardware test, including cancel/expiry and native mySigen recovery.

See [chart source requirements](chart-catalogue.md) for electrical charts that need mapped Recorder sensors. The checks above do not imply that every chart is automatically populated on every installation, or that every firmware accepts every owner setting.

## 0.2.6 status and command-path checks

Backend tests cover charger unit isolation, AC waiting at zero power, optional unsupported values, command-priority release after cancellation, per-request pacing, grouped reads, identity checks immediately before writes, fresh readback reuse, restart recovery and cancellation. A synthetic Hold transaction uses 49 requests instead of 62 on 0.2.5, with the same five writes. Live timing depends on device response and the required checks.

Frontend checks cover connection labels across scenes, countdowns, pending/recovery/expiry states and active action labels. Browser geometry checks include an active Hold in 39 embedded cases plus 24 shrink/restore checks, alongside the five standard documentation layouts. Synthetic fixtures contain no credentials or plant-control client.

## 0.2.7 native configuration

566 backend and 437 frontend tests pass, with Ruff and the official GitHub validation jobs required before publication. Browser checks cover 44 existing overview/embedded layouts, 24 resize transitions and 15 native-preset dialogs across desktop, tablet and phone viewports. The preset checks include scrolling, horizontal containment, source distinctions and preserving an observed DC V2X selection.

Direct read-only testing in isolated HA Test used the configured EU owner account, rather than a browser session. It distinguished a real native Personal Strategy from an empty custom operating-profile catalogue and empty native charging-schedule lists, and verified the saved configuration described in [native settings](native-settings.md). Existing write settings were preserved; new reader coverage is not a physical command-acceptance claim.
