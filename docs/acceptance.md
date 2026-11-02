# Release validation

The validation workflow runs synthetic backend/frontend tests and official Hassfest/HACS checks. See the [live checks](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/actions/workflows/validate.yml), [alpha test guide](alpha-testing.md), and [capability matrix](compatibility.md).

Backend tests exercise transport errors, rate limits, partial acceptance/lost responses, restart recovery, immutable identities, owner priority, SOC/power bounds, expiry, export restrictions, DST/overnight scheduling, conflict detection and competing TC writers. Frontend tests exercise cards, charts, navigation, data normalization, availability, forms and control bindings. Browser examples check desktop, tablet and phone rendering without horizontal overflow or JavaScript errors.

HA Test validation keeps plant writes locked and checks native setup, service registration, module resources, independently running read sources and the optional notification blueprint. No software test or isolated readback proves real-world plant control. Physical command acceptance remains pending invited owner testing.

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
