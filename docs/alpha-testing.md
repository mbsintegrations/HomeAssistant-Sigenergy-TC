# Invited alpha testing

This is a functional control alpha for supervised testing, not stable software. Install through HACS yourself; preserve the existing integration, automation configuration and a full backup. Read [controls and recovery](controls-and-recovery.md). Use the real hardware inventory; screenshot fixtures and demonstration devices are not a live plant.

Record HA/integration version, plant firmware/region, connection choices and starting native settings. Establish one intended writer. Compare local and cloud telemetry with matching units/time/date. Test a bounded command and observe actual battery/grid behavior as well as job readback; software confirmation cannot replace physical acceptance. Verify cancellation, native expiry, restoration, owner override, cloud outage, HA restart recovery and rule-window end. Do not induce a grid outage, alter protection settings or enable unapproved export to test availability.

The release must pass synthetic backend/frontend tests and official validation before publication. Isolated HA Test checks installation, services, source availability, assets and safety locks without sending plant commands. Those results do not certify the invited owner's hardware. Report uncovered combinations so this document and capability matrix can be updated.

Use [GitHub Issues only](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues) for bug reports and feature requests; do not send them by email, Facebook, Messenger or private message. Include reproducible steps, source choice, date/time zone and relevant versions. Keep secrets and private plant data out of issues and screenshots. See [reporting requirements](../SUPPORT.md). Do not post the release to public groups or invite additional testers on behalf of MBS without agreement.

## Expanded control tests in 0.2.0

All implemented owner writes can be enabled; the release has no artificial read-only alpha switch. Existing entries keep their previous enablement. Installation and connection setup send no plant commands.

Test charge, both discharge destinations, hold, self-consumption, cancellation, command replacement and expiry. Exercise local and cloud separately, then combined. Check original settings in mySigen after every restoration. For local tests keep HA running, verify the real inverter unit ID, and confirm no other Modbus writer is active. Local home-only discharge caps total grid export at zero; cloud discharge preserves separate PV export.

Test supported owner settings through their popups and native HA actions, including stale edits made concurrently in mySigen. Do not enable export before the site has permission. Test only discovered installed chargers/gateways; an absent device or unsupported firmware response is not a successful control test. Native charger schedules, V2X, firmware/installer operations and external AI execution remain outside this release's working controls.

## Native Personal Strategies in 0.2.8

The [native strategy workflow](native-strategies.md) now supports New, Change, Rename and Delete. Software and read-only account contract checks passed; real create/change/rename/delete acceptance remains pending. Under owner supervision, use a separate disposable rule, inspect the exact proposal and timing, verify the saved rule and unchanged existing rules in mySigen, then remove the disposable rule. Do not alter a needed charging rule merely to test the interface. Record firmware, requested operation, response, native readback and physical behavior separately.
