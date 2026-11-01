# Charts and their data sources

Charts share one calendar selection in the full dashboard. Standalone chart cards keep their own selection. The Default layout groups related charts and consolidates solar/forecast and PV string measurements; individual charts remain selectable in customization.

| Chart | Data source and requirements |
| --- | --- |
| System power, solar, household load, battery, grid, AC and DC power | Available mySigen Cloud history and/or mapped HA Recorder statistics. The device/account must supply that series. |
| Battery state of charge | Cloud SOC history and/or the recorded battery SOC sensor. |
| Buying/selling price and SOC | Configured tariff schedules plus measured SOC history. Tariff prices are not household bills or verified revenue. |
| Solar forecast | Selected installed forecast integrations. Up to two sources may be averaged; missing data is excluded. Forecast data is not measured production. |
| PV string power, voltage and current | Mapped string sensors with Recorder statistics. Aggregate plant Modbus telemetry does not automatically expose these string measurements in this version. |
| Inverter output/temperature; grid voltage/current/frequency/reactive power | Mapped sensors with Recorder statistics. These are not supplied automatically by the aggregate Modbus reader or the Cloud plant-history endpoint. |
| Battery temperature and state of health | Mapped sensors with Recorder statistics. A discovered module's live temperature is not automatically an aggregate battery-temperature history mapping. |
| DC voltage/current/vehicle SOC | Mapped charger sensors with Recorder statistics. Cloud plant history supplies charging power/energy, not all charger electrical measurements. |
| Optimizers | Actual mapped optimizer sensors. No optimizers or panel measurements are invented. |

Use the visual card configuration or the `entities` mapping described in [Cards](cards.md). `history_entities` may explicitly link an older sensor's statistics when its identity and units match. Existing sensors from another integration can supply these mappings; installing TC cannot recreate history that was never recorded. Excluded entities and Recorder settings still apply.

Day views use power or other instantaneous measurements. Cloud calendar energy views use the measured kWh buckets returned for the selected period; they are not averages of kW. Local daily totals require a valid midnight counter baseline. First-day measured Cloud buckets may cover that gap. Missing readings remain missing rather than becoming zero.

Cloud charts share the account request gate and a cached history broker, so opening additional cards does not create independent polling loops. Local results can appear before Cloud history finishes. Optional electrical charts may remain empty until their inputs are mapped and recorded. A rendered chart does not establish hardware support or data coverage.
