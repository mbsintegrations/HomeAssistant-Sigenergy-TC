# Cards, layouts and setup wizard

The alpha bundle includes a dependency-free custom card, `custom:sigen-hybrid-card`. It does not require card-mod, Mushroom, ApexCharts, a CDN or another card library. It uses Home Assistant's card and configuration interfaces.

## Guided setup

Initial integration setup now guides the owner through:

1. Isolated Demo, a local read-only connection or optional cloud-only reads.
2. Optional forecast provider, optimizer-monitoring interest, and optional cloud reads. The optimizer choice records a preference only; no Tigo driver is implemented.
3. Selection of loaded forecast data, when chosen. Missing providers show installation guidance, and the owner can choose no forecast to continue.
4. Optional app-cloud region, username/password and explicit opt-in. This can be skipped. When enabled, setup authenticates and discovers the account's plant automatically; there is no station-ID input. No NBI key or developer application is required.
5. Complete overview, house, simple flow or separate-card preference; day/night setting; and desired charts.
6. A review showing selected features without echoing credentials.

These preferences are saved with the configuration and can be changed later. They do not create or overwrite dashboards. The bundled module registers automatically in storage-mode dashboards; placement remains the owner’s choice.

## Add the dashboard resource

YAML resource users can add the following JavaScript module resource. Storage-mode registration is automatic when no TC resource already exists:

```text
/sigen_hybrid/sigen-hybrid-card.js?v=0.2.1
```

Then add **Sigenergy TC** from the dashboard card picker. Choose the integration configuration in its visual editor. Discovery maps enabled entities belonging to that exact `sigen_hybrid` entry, using entity registry identity rather than guessing entity names. Explicit mappings override discovery, and `null` disables a discovered item.

The source is served by the integration. No static endpoint serves account data or credentials. The card only reads HA states and cached recorder statistics; command buttons request a server-validated **preview** with `dry_run: true`.

## Complete and separate views

Use the visual editor's `view` setting, or these presets in `dashboard/`:

| View | Contents |
| --- | --- |
| `overview` | One outer card: the settings-selected House/Photo house/Flow display, compact daily energy and battery panels, preview controls, forecast, daily totals, Overview/Energy/Charts/Devices tabs, plus Service and Settings shortcuts |
| `house` | Original day/night house layers with mapped readings and directional animation |
| `flow` | Simpler animated system-flow diagram, with optional battery/EV nodes |
| `statistics` | Metered source/consumer totals with familiar Sigenergy colours and two-sided flow ribbons |
| `power` | Calendar views of recorded power, distinct household and EV series, and an optional forecast overlay |
| `solar_chart`, `load_chart`, `battery_chart`, `grid_chart` | Separate recorded solar, household load, battery charge/discharge and grid import/export charts |
| `tariff` | Current configured buying/selling rates and recorded dual-scale SOC/price trends |
| `battery`, `solar`, `grid` | Individual device cards |
| `forecast` | Optional cached daily forecast readings and available forward intervals |
| `controls` | Bounded manual-control preview dialog |
| `optimizers` | Owner-mapped existing module-power sensors, including a stale-data indication |

The overview's **Photo house** choice uses a scene renderer adapted
from [Jean-Yves Avenard's Sigenergy Flow Card](https://github.com/jyavenard/sigenergy-flow-card),
v54 at commit `86f82a214c7a46998db7e5a880f7799e8d54cde5`, under
[Apache-2.0](../licenses/jyavenard-Apache-2.0.txt). It is bundled with this card and
needs no separate HACS card or resource. It uses the same mapped readings,
device-detail windows and charts as the other displays. Its newly generated
day/night house images and countryside background replace the upstream
photographs; [artwork source records and prompts](../custom_components/sigen_hybrid/frontend/assets/README.md)
are retained with the assets. Only the selected image is loaded.

Choose the default under **Home options > Custom > Main display** and save the
preference in this browser. Only that scene is rendered. The optional
`show_display_picker: true` card setting exposes temporary House/Flow/Photo
house buttons for comparison in HA Test; it is off by default. It does not
change the plant's mode. The scene scales with the available card width.
Tablet and desktop place the solar forecast above today's energy, battery
level and manual controls beside the scene; phone layouts stack these panels.
The photograph fills its frame without solid header or footer bands.

The energy-statistics Sankey fills its panel. Ribbons estimate allocation
between independently measured counters. Missing optional EV daily totals do
not hide the other balanced, recorded flows; those EV values remain unknown
and a brief status identifies the partial diagram. Missing core counters or
a material energy mismatch prevent an allocation from being drawn.

The wizard's preset, appearance and main display are inherited when the corresponding card settings are omitted. Saved Homepage appearance preferences override the default scene in this browser. For a card with a fixed initial scene, set `main_display: house` (or `flow` / `photo`) and `follow_saved_display: false`; temporary scene preview buttons still work. Chart preferences select the complete card's Energy/Charts tabs. Individual-card preference means the owner chooses individual views; it does not automatically add several cards to a dashboard.

Service and Settings open nested windows within the card. They do not add or
rename HA dashboard views. The internal navigation strip scrolls horizontally
when the card is too narrow for all shortcuts.

Configured measurement nodes remain visible as unavailable when readings
disappear; unconfigured nodes are omitted. Supplied inventory rows can remain
visible with unknown measurements. The card does not discover or poll AC/DC
chargers or Tigo modules: it displays existing mapped sources. Forecast daily
totals, tariff rates and daily energy counters likewise require appropriate HA
sources.

## Phone, tablet and computer

CSS container queries respond to the actual card width, including a narrow section on a large screen:

- Narrow phone/section: stacked layout, two-column energy tiles, wrapping status badges and touch-friendly controls.
- Tablet or medium-width section: the selected scene alongside the forecast, today's energy and battery summaries.
- Wide computer section: manual controls below the scene, with the three stacked settings controls aligned to the same top and bottom edges in the summary column.

House, Photo house and Flow use the same overview shell and controls. The Flow
diagram is centred and reduced on wide cards. Detailed energy statistics and
charts live on their own tabs; the overview ends after the controls and summaries.

The summary column combines today's PV production, home consumption and battery
SOC in one three-circle panel. Only SOC represents percentage progress; energy
circles show measured daily totals without inventing a target. Each circle opens
its own details. The Energy diagram uses the available viewport height on larger
screens so the daily totals remain visible underneath.

Charts are grouped into System overview, Solar & inverter, Home consumption,
Battery, Grid, AC charger and DC charger. Telemetry updates reuse connected chart
elements rather than rebuilding the page, retaining scroll and selected periods.
Default combines solar production with forecast and PV string power with voltage
and current. Each electrical quantity retains its own compact scale; expanded
charts provide larger plots. AC and DC charging power share a row. Detailed DC
electrical charts and vehicle SOC remain optional customization choices.
The separate home-consumption chart is omitted
from Default because it appears in Power metrics. **Customize charts** on the
Charts page or under Homepage appearance offers all combined and individual
charts; selections are local browser preferences. Unpaired charts fill a row.
Battery SOC & price trend appears last. Production, consumption and lifetime
summary cards open from **Energy → Energy totals**, outside the chart catalogue.
The Energy flow diagram fills the panel width at its existing viewport height,
with responsive coordinates that keep text proportions unchanged.
Individual DC cards use `dc_chart`, `dc_voltage_chart`, `dc_current_chart`,
`dc_soc_chart` or `dc_metrics_chart` as their card `view`.

The Sections grid default is 12 columns and content height, with a minimum of 6 columns. Light/dark appearance supports `auto` (HA sun entity), `day`, `night` or `theme`. Unknown sun state falls back to HA theme. Reduced-motion preference stops flow and optional weather animations.

## Home options and saved layouts

The Home options button exposes **Search**, **Custom** and **Weather**.

- **Search** finds existing local functions, supplied device/panel names, mapped
  readings and supplied alerts. Help resources link to verified official pages.
  Forum content is not fetched or invented; configured Community links open the
  vendor page when selected. The assistant shortcut opens the local planning page.
- **Custom** provides Classic/Advanced layout presets, module visibility,
  ordering by position, move buttons or drag, and Restore defaults. These are
  layout presets, not energy operating modes.
- **Weather** opens the same appearance editor at its immersive-weather option.
  Effects use the configured HA weather state and respect reduced motion.

Editing the form changes its draft only. Save commits the appearance preference
to this browser; closing the window redraws the overview. The original
configuration and desktop sidebar remain the default until a saved layout
changes module order or visibility. Weather-only changes keep that grouping.
Manual controls have their own visibility option; hiding the battery summary
does not implicitly hide them. Restore returns the editor to the card's configured
defaults and still requires Save.

**Settings → Homepage appearance** includes Auto, Day, Night and Home Assistant
theme. Auto follows the HA sun state and switches the Photo house artwork at
day/night transitions. The background can use the theme, a custom colour, or a
local HA / HTTPS image URL; this changes the outer card background, not the house
artwork. Temporary Scene, Appearance and Layout badges change only this card's
in-memory preview. Reset restores its saved choices without changing the plant.

## Original mySigen artwork

Use clean original artwork as separate local image layers, with no static readings embedded. The card accepts `images.day` and `images.night`, each containing `house`, optional `battery`, `gateway`, `ac` and `dc` URLs. Layers must share an aligned canvas. Use a house variant matching the installation; this prototype does not remove baked-in panels or cars from a chosen image.

```yaml
type: custom:sigen-hybrid-card
view: overview
appearance: auto
# Choose your integration configuration in the visual editor.
images:
  day:
    house: /local/sigen-artwork/day/house.png
    battery: /local/sigen-artwork/day/battery.png
    gateway: /local/sigen-artwork/day/gateway.png
  night:
    house: /local/sigen-artwork/night/house.png
    battery: /local/sigen-artwork/night/battery.png
    gateway: /local/sigen-artwork/night/gateway.png
```

The exact original villa day/night and equipment files were located in the public mySigen web assets and retained outside this source tree for private preview. The current house template reproduces the video reference's scene coordinates, labels, leaders and cable routes. Native equipment sprites are positioned using their original canvas bounds; this template expects the matching villa asset family. Power highlights use measured direction and stop on idle/stale/unavailable inputs. Reduced motion and `animations: false` stop animation.

The original mySigen villa artwork and fonts are not relicensed under this project's GPL or bundled for public distribution. Confirm Sigenergy's artwork redistribution permission before a community release. The separately credited Photo house scene uses the upstream distribution described above. The integration's own branding remains separate.

## Entity mappings

Supported optional `entities` keys:

```text
solar_power, home_power, grid_power, battery_power, ac_power, dc_power,
battery_soc, battery_capacity, native_mode, control_status, grid_status,
export_permitted, forecast_status, forecast_today, forecast_tomorrow,
buy_price, sell_price, solar_today, home_today,
battery_charge_today, battery_discharge_today,
grid_import_today, grid_export_today, ac_today, dc_today,
cloud_mode, cloud_status
```

These are common mappings; device pages also accept their relevant temperature,
health, voltage/current, status and lifetime-energy mappings. Only
sensor/binary_sensor mappings are accepted in `entities`. Configure weather and
sun through `weather_entity` and `sun_entity`. Power units must be W/kW/MW, energy
Wh/kWh/MWh and SOC %. Power sign convention is grid positive = import, battery
positive = charging. Do not map an incompatible integration's signed readings
without normalization.

For tariff history, supported units are EUR/USD/GBP or symbols per kWh, or cent/pence per kWh; the card normalizes minor units. Use consistent currency for buying and selling and provide the `currency` attribute. Negative prices are retained. Other units remain unavailable. History depends on recorder statistics being present; it never manufactures samples or fills gaps with zero.

An optimizer mapping is a list of `{name, string, power}` objects pointing at existing power sensors, for example a selected Tigo data integration. Compact tiles group by string and fit up to 12 across or down; narrow cards reflow to keep values readable. `panel_orientation` selects `portrait` or `landscape`; `panel_flow` selects `horizontal` or `vertical`. This is a monitoring bridge, not a Tigo transport or an optimizer control interface. Module readings older than 30 minutes are marked unavailable.

The mySigen Tigo page inspected on 27 October 2026 lists TS4-A-O, TS4-A-S,
TS4-X-O and TS4-X-S, and states that Tigo Premium is required for mySigen's own
account link/sync. That binding was not performed. This card continues to use
owner-mapped HA sensors; it does not implement that vendor account-linking flow.

## Device pages, charts and settings

The card now has a shared detail window with nested Back navigation, Close,
Escape and unsaved-change handling. House equipment and labels, flow nodes,
daily totals, forecast tiles, optimizers and device inventory open grouped
details instead of stopping at a single HA sensor. Individual entity inspection
is still available from device details.

Optional `devices` inventory rows use `id`, `type`, `name`, `model`, `serial`,
`entities`, `parameters` and explicitly typed `realtime` values. Supported types
include `inverter`, `battery_module`, `gateway`, `solar`, `string`, `ac` and `dc`.
Module readings must have their own mappings; aggregate battery SOC or power is
never substituted for an individual module. Missing phase readings stay absent.
When at least two PV strings have explicit own power sensors, Solar details show
their histories together as separate series. The chart normalizes each source's
power units; it does not calculate string power from voltage/current or use the
inverter's AC output as PV production.

The reusable chart includes calendar Day/Week/Month/Year/Lifetime ranges, plant
timezone and DST handling, selectable legends, pointer/touch/keyboard values,
expansion, a data table and local CSV export. Weeks start on Monday by default;
`week_start` accepts 0–6, with 0 meaning Sunday. Available plant forecast intervals
are a separate dashed series on aggregate Solar/Power charts, never a substitute
for a device's own history. Valid supplied sunrise/sunset times appear only on
their matching current Day view. Missing values remain gaps, and prices retain
their currency. A load forecast is not implemented.

Reading updates preserve the selected chart date/range, hidden legend series,
expanded window and in-progress history load. Weather hero values refresh in
place. Editable or dirty settings forms are protected from background redraws.
Calendar energy statistics use reported daily or lifetime counters, or explicit
`energy_periods` data; a missing period never reuses today's totals. Week totals
come from `energy_periods.week` keyed by the selected local week's start date.

`overview_sections` remains accepted for compatibility with older card
configurations, but does not add lower sections to Overview. Use Energy, Charts
or an individual card view for statistics, power and tariff charts, energy value,
production, consumption, environmental benefits and strategy summaries. Saved
Homepage appearance visibility applies to the four overview modules: forecast,
today's energy, battery level and manual controls.

Energy Value and Environmental Benefits expand using the same data as their
overview summaries. Energy Value shows measured currency totals or costs from
complete, reconciled energy/rate intervals; a current tariff is not applied to
an entire day's consumption. Its calendar links require their own period data.
Environmental Benefits retain the configured Today/Lifetime solar source and
show explicit conversion factors. Calculated equivalents are labelled estimates;
missing factors or energy remain unavailable.

Settings pages cover energy/system/app settings, modes, seasonal tariffs,
priorities, charger modes/schedules/records, vehicles, PV metadata, indicators,
safety, forecasts, connection capabilities and AI planning. Their saved drafts
live in this browser, scoped to the integration entry. Display preferences apply
locally; the other drafts do not alter Sigenergy settings, change backend safety
limits or execute an automation. Plant Apply/Start controls remain locked.
The mode draft offers the five observed choices: Self-Consumption, Sigen AI
Mode, Time-based Control, Fully Feed-into Grid and Remote EMS Mode. Vendor mode
activation and Add/Import workflows are not implemented.
**My Energy Profile** is accessible from the Home energy-settings gear, battery
summary and Settings. It groups the observed grid import/export and connection
limits, peak shaving, battery levels/preheating/power, solar priorities/limits,
backup, energy-saving and aggregator pages, plus charger shortcuts. Values use
explicit supplied profile data; the new plant-setting pages are read-only, with
no inferred enabled state, default limit or provider command.
The manual form sends dry-run previews only, offers 30/60/90/120/180-minute presets
and a custom duration up to the controller's validated bound (at most 1440 whole
minutes), and enforces verified power limits. Visible durations do not establish
device/API acceptance.

AC and DC device pages have separate **More** hubs, retaining the selected
charger's identity. Both provide read-only OCPP status and supplied card lists;
OCPP credentials are not displayed, and card add/delete actions are disabled.
Authorisation is a section heading. AC pages also show available dynamic-load,
output/P1 phase, off-grid charging, indicator-light and connectivity facts, with
Ethernet/WLAN/Cellular drilldown. DC pages show explicitly supplied allowed
charging power, vehicle cut-off SOC and V2H guidance, without persisting an
acknowledgement or enabling operation.

These pages use the selected inventory row's mapped entities or scoped
`charger_settings` metadata (`ac_settings`/`dc_settings` are also accepted).
Config-level metadata must be keyed by that device's ID. There is no fallback
from another charger, the plant's grid status or a global cloud/network status.
Unknown settings remain unavailable; no charger defaults or ratings are inferred.
Charger schedules have a device-scoped list and separate stable local draft
identities. Supplied charging records support local date filtering and keep
known-empty records distinct from unavailable history. Neither browsing records
nor saving a schedule sends a charger command.

## Service, system information and external destinations

Service shows supplied provider contacts as text, with Diagnosis, Message,
Support, Community and alert shortcuts. Message categories and record details
use supplied data only; no read-state, mark-all or delete action is sent.
Active/history alerts have search, device-type and date filters. Diagnosis and
Care pages display supplied reports and mapped facts, with no inferred health
scores or successful tests.

About, software, warranty, network and Modbus pages show available facts. Unknown
firmware, expiry, phase or module values remain unavailable. Warranty download
opens a supplied safe document URL. It does not generate a warranty certificate.

| Destination | Behavior |
| --- | --- |
| System sharing | Native HA user management; no Sigenergy invitation or role change |
| App settings | Supplied HA locale/units/theme and the native HA profile |
| Accounts/Add System Device | Native HA integration management; no vendor commissioning |
| Data download | Existing calendar chart and local CSV download; no email/cloud export |
| Help, Support and Community | Verified or explicitly supplied safe links, opened only when selected |
| Support history | Read-only supplied records; authenticated vendor tickets/workorders remain external |

Start charging, Start test, Check Again, Power-On, Power-Off and Go Off-Grid remain
disabled. Software updates and changing the Modbus server are not implemented.
Fault-report submission, attachments, contacts/delivery details and Community
onboarding remain in the vendor interface; the card does not recreate those flows.
The vendor Add Device choices for smart loads, SG Ready heat pumps, third-party
inverters, grid-side sensors, generators, MID meters, EMI and AndSolar are not
commissioning or backend-support claims for this integration.

The frontend uses HA entities and Recorder reads, never direct Sigenergy requests.
All JavaScript assets must be installed together. Private review copies may
be served from HA's static frontend directory while a cloud entry is disabled;
that does not enable the integration or authenticate to Sigenergy.

## Limits and validation

Standalone development previews can use synthetic data. Layouts and preview-only
interactions have been checked at phone, tablet and computer widths, including
isolated HA comparison screens. These checks do not establish physical operation
or complete native HA/device acceptance.

Private comparison previews also use captured real HA states and recorder statistics, with optional animation replay. Unavailable equipment may use simulated readings for interface review, retaining provenance in internal metadata without visible sample captions. Household captures and review configurations are outside this repository. `snapshot_at` freezes a comparison chart's time window and animation reference; it does not change backend freshness validation or enable controls.

The statistics card uses a proportional two-sided ribbon layout. Node totals
remain independently metered; ribbons represent estimated allocations. Missing,
inconsistent or infeasible totals suppress them. Calendar ranges including Week,
forecast overlays, settings drafts and summary panels are implemented. Physical
mode changes and automatic cost optimisation remain outstanding.

Read-only portal inspection now includes selected Home/customisation, device,
settings, Service/message, alert, diagnosis and support screens. It is not an
exhaustive audit. Deeper external-meter/EMI configuration and authenticated
support/workorder behavior remain unverified; unread vendor messages and vendor
Save/Invite/test/power actions were not exercised. See the
[interface implementation ledger](interface-parity.md) for current scope and the
[mySigen chart inventory](chart-catalogue.md) for the earlier comparison backlog.
Full app or control parity is not claimed.
