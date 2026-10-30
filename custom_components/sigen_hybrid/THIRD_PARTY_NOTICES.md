# Third-party notices

Own integration source is licensed GPL-3.0-only. Compatible MIT and Apache-2.0 material keeps its original notices below and in the `licenses` directory.

| Source | Use | License notice |
| --- | --- | --- |
| [TypQxQ/Sigenergy-Local-Modbus](https://github.com/TypQxQ/Sigenergy-Local-Modbus) | Narrow register definitions adapted into `core/registers.py`; upstream register source recorded at blob `b040b69320e5a07df351dc6233ab68aa76fe65df` | [MIT](licenses/TypQxQ-MIT.txt) |
| [solidfox/sigenergy-cloud](https://github.com/solidfox/sigenergy-cloud) | Optional pinned `sigenergy-cloud==0.1.7` dependency; wrapper supplies opt-in, station checks and caching | [MIT](licenses/solidfox-MIT.txt) |
| [seud0nym/sigenergy2mqtt](https://github.com/seud0nym/sigenergy2mqtt) | Consulted for local control/register behavior; no daemon bundled | [MIT](licenses/seud0nym-MIT.txt) |
| [kjmcfall/sigen-flow-card](https://github.com/kjmcfall/sigen-flow-card) | Sankey minimum node sizing and two-sided ribbon layout, adapted through the existing Home Energy card; original copyright also retained in the frontend module | [MIT](licenses/kjmcfall-MIT.txt) |
| [jyavenard/sigenergy-flow-card](https://github.com/jyavenard/sigenergy-flow-card) | Photo house rendering and animation approach adapted into `custom_components/sigen_hybrid/frontend/sigen-hybrid-photo.js` from v54, commit [`86f82a214c7a46998db7e5a880f7799e8d54cde5`](https://github.com/jyavenard/sigenergy-flow-card/commit/86f82a214c7a46998db7e5a880f7799e8d54cde5); Copyright 2025-2026 Jean-Yves Avenard | [Apache-2.0](licenses/jyavenard-Apache-2.0.txt) |

The Photo house adaptation retains the upstream copyright and Apache-2.0
header. It modifies the upstream implementation for scene-only rendering with
Sigenergy TC readings, appearance, animation and device-detail actions.
Upstream charts, history/statistics fetching and control paths are omitted.
The modified module carries its own change notice. The pinned upstream
distribution contains no separate `NOTICE` file. Upstream photographs and
charger overlays have been removed. The day/night photographs in
`frontend/assets` were generated for this project; their delivery assets are in that directory. Their cable paths and framing were remapped for
the new scene. No Sigenergy endorsement is claimed.

`pymodbus` (tested with 3.13.1) is an external dependency distributed under its own BSD-3-Clause license. Home Assistant and forecast integrations are separately installed software; their code is not bundled here. Review dependency licenses and the complete distribution before a public release.

Vendor documentation and names identify interoperability targets. This project is not an official Sigenergy or Tigo product.
