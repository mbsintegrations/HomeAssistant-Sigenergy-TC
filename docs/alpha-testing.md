# Invited alpha testing

This is a functional control alpha for supervised testing, not stable software. Install through HACS yourself; preserve the existing integration, automation configuration and a full backup. Read [controls and recovery](controls-and-recovery.md). Use the real hardware inventory; screenshot fixtures and demonstration devices are not a live plant.

Record HA/integration version, plant firmware/region, connection choices and starting native settings. Establish one intended writer. Compare local and cloud telemetry with matching units/time/date. Test a bounded command and observe actual battery/grid behavior as well as job readback; software confirmation cannot replace physical acceptance. Verify cancellation, native expiry, restoration, owner override, cloud outage, HA restart recovery and rule-window end. Do not induce a grid outage, alter protection settings or enable unapproved export to test availability.

The release must pass synthetic backend/frontend tests and official validation before publication. Isolated HA Test checks installation, services, source availability, assets and safety locks without sending plant commands. Those results do not certify the invited owner's hardware. Report uncovered combinations so this document and capability matrix can be updated.

Use GitHub issues for sanitized functional/UI reports. Include reproducible steps, source choice, date/time zone and relevant versions. Keep secrets and private plant data out of issues and screenshots. Do not post the release to public groups or invite additional testers on behalf of MBS without agreement.
