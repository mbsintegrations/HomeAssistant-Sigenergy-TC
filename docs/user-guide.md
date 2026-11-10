# Sigenergy TC user guide

## Install and place the dashboard

1. Follow the [installation guide](installation.md) to add the custom HACS repository or use the manual ZIP. Restart Home Assistant before adding the integration.
2. Choose Modbus, mySigen Cloud or both. Check the connection indicators and verify the detected plant and devices against mySigen.
3. Select your weather entity and optionally configure [solar forecasts](installation.md#forecasts). When averaging two forecasts, use providers configured for the same array.
4. Use **Configure → Add to dashboard** to place TC on an existing page, in a compatible custom Solar menu, or on a separate dashboard you create in HA. To build your own layout, choose individual cards and charts. [Placement and layout](dashboard-embedding.md) · [Card catalogue](cards.md)

## Find your way around

| Tab | What you can do |
| --- | --- |
| Overview | Check live energy flow, today’s totals, forecast and battery SOC. Click scene labels or summary tiles for details. Use manual battery and charger controls when their routes are available. |
| Energy | Inspect energy totals and the flow breakdown for a selected period. |
| Charts | Choose a date and period, browse categories and use **Customize charts** to choose which charts appear. Check the chart’s data source when history is empty. [Chart catalogue](chart-catalogue.md) |
| Devices | Open the inverter, battery modules, gateway or installed charger details supplied by your connections. |
| Settings | Set appearance and cards, manage forecasts, connections and supported owner settings. |

A dash means the value is unavailable. A zero can be a valid measurement. Modbus keeps supplying local readings when an independently configured Cloud connection is temporarily unavailable. Features that need Cloud recover when that connection returns. [Capability matrix](compatibility.md)

## Battery and grid controls

1. Enable the desired owner control connection and verify your SOC, power and export limits. Give one controller ownership of writes.
2. From **Instant manual control**, select Charge, Discharge to Home, Discharge to Grid, Hold battery or Self-consumption. Review the duration and power choice before applying. Grid export requires the site’s export permission.
3. Watch the status and actual plant power. A request can take time to settle. An active timed override shows its remaining duration and provides **Cancel override**.
4. Gateway transfer is available only when the connected gateway reports that support. Verify grid state after applying a transfer. Follow the [control and recovery guide](controls-and-recovery.md) for restoring settings or handling an unavailable connection.

## AC and DC charging

Open an installed charger on the Overview or Devices tab. Fresh charger status disables **Start charging** while charging and **Stop charging** while idle. You can still stop a waiting session that TC started.

For an AC or DC charger in PV Surplus mode, choose **Wait for solar** to keep that mode, **Temporary Fast Charging** to allow a single fast session, or **Cancel** to exit. Watch for charging and restoration status. TC needs HA and Cloud to reconcile and restore the previous settings. Verify the original mode in mySigen if a session is interrupted. [Charger session behavior](release-0.2.10.md#changes)

## Tariffs, strategies and automations

- Use **My Energy Profile** to view available native tariffs or set local rates. Add time windows for variable import or export rates and check the time zone. The forecast-based planner provides recommendations. [Tariffs and schedules](strategies.md)
- **Personal Strategies** separates plant-native rules from HA schedules. Plant-native changes need supported Cloud control and a review step. HA schedules need their own master enable and an available command route. [Native strategies](native-strategies.md)
- To use HA automations, review available actions in [controls and recovery](controls-and-recovery.md) and check for overlap with mySigen schedules or another HA integration.

## Troubleshooting and removal

Compare the source indicators, device inventory and timestamps before troubleshooting a missing reading. For charts, check the period, Recorder and any required sensor mapping. For recovery, updates, rollback or removal, use the [installation guide](installation.md) and [troubleshooting](troubleshooting.md). Submit sanitized bug reports and feature requests through [GitHub Issues](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues).
