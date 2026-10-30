# mySigen chart comparison and implementation backlog

Inspected the owner-enabled mySigen Home dashboard on 26 October 2026. This lists observed features and data needs, not a claim of complete implementation or API availability.

| Observed feature | Current development coverage | Required follow-up |
| --- | --- | --- |
| Energy Statistics, date and Day selector | Proportional Sankey with metered daily totals, gradients, optional devices and allocation estimates | Calendar periods and recorded counter baselines; use reported cloud allocation only with source/time metadata |
| Power Metrics: solar, battery, EVDC, grid, load, EVAC; forecast overlay; sunrise/sunset | Recorded power series, normalized signs, five-minute averages | Calendar periods, forecast series, sunrise/sunset, selectable legends and zoom |
| Battery SOC & Price Trend | Recorded SOC and supported-unit price series on separate scales | Complete tariff schedules and recorded/forecast extensions |
| Energy Value and Total Revenue | Not implemented | Separate actual bills, avoided import cost, export revenue and battery losses; explicit tariff model and provenance |
| PV Production routing: battery, EVDC, load, EVAC, grid | Local estimates represented in Sankey | Dedicated breakdown card and optional cloud-reported allocation, with matching reporting interval |
| Consumption routing: solar, battery, EVDC, grid | Local independent totals and estimates | Dedicated breakdown card, measured versus estimated labels and cloud source support |
| Solar power with forecast | Combined power graph | Separate solar chart and provider overlay |
| Load power with forecast | Recorded household power | Separate load chart; demand forecast must have a verified source/model |
| Battery discharge & charge | Signed battery series | Dedicated split-direction chart and energy totals |
| Grid imported/exported | Signed grid series and daily counters | Dedicated split-direction chart, import costs/export revenue and permission context |
| Energy Produced: month, year, lifetime | No full period summary yet | Unit-normalized long-term counters/statistics, resets and partial commissioning periods |
| Sigen AI value comparisons | Not implemented | Define baseline and assumptions; vendor estimates are not verified savings or household bills |
| Environmental Benefits: CO2, coal, trees | Not implemented | Optional configurable conversion factors, jurisdiction/source/date and estimate labels |
| Instant Manual Control and personal strategies | Bounded preview UI and initial advisory planner | Real acceptance, owner handback, supported modes/routing, durable schedules and policy compiler |

All of these should be available as optional full-dashboard sections or individual cards where meaningful. Setup should explain additional provider/permission requirements and permit features to remain disabled. Avoid requesting frequent cloud reads where local counters or HA recorder data are sufficient.

Owner-approved comparison previews use private HA snapshots and recorder data. Missing features may use clearly labelled sample values. The public source contains neither household snapshots nor account credentials. Cloud and HA samples must not be silently combined when their reporting periods or refresh timestamps differ.
