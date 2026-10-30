# Navigation and availability

The full interface has Overview, Energy, Charts, Devices and Settings. Service information belongs under Settings. Overview focuses on the chosen scene, live power, daily energy, forecasts and reachable controls. Charts share period controls and are grouped by system, solar/inverter, battery, grid, chargers and tariffs/SOC. Device/settings pages avoid duplicating the main chart catalogue.

Photo House, House and Flow change the main scene while keeping the surrounding controls consistent. Phone layouts move small scene measurements into readable power tiles. Details open through labels/cards; keyboard activation and close/back behavior are part of the frontend tests. Standalone cards and supported dashboard shells reuse these renderers.

Availability follows configured sources, freshness, installed devices and native capability. An enabled source outage is temporary unavailability; a feature needing an unconfigured source must not be presented as an executable control. Saved local preferences/drafts are distinct from native setting operations. See the [capability matrix](compatibility.md) for alpha boundaries.
