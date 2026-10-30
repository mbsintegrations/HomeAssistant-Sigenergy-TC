# Capability matrix and alpha boundaries

| Feature | Modbus only | Cloud only | Both |
| --- | --- | --- | --- |
| Local plant power/SOC/native energy counters | Yes, when enabled by installer | No | Preferred local source |
| Cached cloud plant readings and available history | No | Yes | Additional/fallback source |
| Operating mode/profile selection | No | Advertised modes with owner control enabled | Cloud route |
| Native timed battery controls and rule execution | Locked without verified local expiry | Supported native cloud handler | Cloud route, local safety readings when fresh |
| Gateway and charger start/stop controls | Not exposed by this alpha | Only advertised supported devices | Cloud route |
| Owner SOC settings | Not exposed by this alpha | Closed native handler | Cloud route |
| HA Recorder history | From recorded local sensors | From recorded cloud sensors | Merged where identity/units agree |
| Optional forecasts, tariffs and dashboard | Yes | Yes | Yes |

Tested development runtime: Home Assistant 2026.10.1/Python3.14. Modbus uses the plant address/unit247 for aggregate readings; this is not arbitrary inverter unit1 discovery. Firmware, region, account permissions and installed hardware affect exposed data. Multiple plants need separately validated identities. Live physical command acceptance must be established by invited testers on their hardware.

Historical readings differ from instant measurements. Native daily cloud totals, local cumulative-counter differences and recorded power integrals are not interchangeable. First-day local totals need a verified midnight baseline; an absent baseline is not a valid zero. Cloud history depends on the endpoints/account retaining that data; Modbus is not an arbitrary historical database.

Cloud-only installations use shared pacing/caching, cooldown after throttling and no blind control retry. Polling does not happen once per card. History requests use caching and the same account gate. This reduces traffic, but cannot promise immunity from undocumented Sigenergy limits or another app's simultaneous sessions.

Not implemented as working plant controls: installer protection/grid-code changes, reboot/firmware updates, V2X dispatch, native charger schedules, unsupported charger options, direct Tigo monitoring and external AI execution. Some optional configuration screens save local preferences/drafts; a saved draft must not be described as an applied plant setting. Optimizer/module views require real mapped/discovered data; a new real entry does not invent panel counts or battery modules.

This release uses the unofficial password-based mySigen app interface. Official NBI/API developer access and Sigen MCP are outside this release. No commercial-grade availability, firmware compatibility or absolute financial saving is implied by the Total Control name.
