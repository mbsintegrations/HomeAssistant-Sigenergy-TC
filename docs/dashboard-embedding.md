# Dashboard placement and interface settings

Open **Sigenergy TC → Settings → Add to dashboard** using a Home Assistant administrator account.

Choose a storage dashboard and one of these destinations:

- **New Home Assistant page** creates a panel view containing the complete interface.
- **Existing page** adds the card without removing existing content. Sections dashboards receive a full-width card; existing panel content is retained in a vertical stack.
- **Custom menu** places the interface inside a supported shell menu entry. The current adapter supports the extended Tab A7 shell. Unsupported shells still support a separate native HA page; their internal menus require a shell-specific adapter.

Before saving, the installer checks the dashboard has not changed. It keeps the last five before/after configurations in the administrator's native HA frontend user storage (`sigen_hybrid_dashboard_backups`) and verifies the saved configuration. This is a frontend concurrency check, not an atomic server transaction. YAML and automatically generated dashboards should be edited through their owning configuration.

## Custom shell contract

The Tab A7 adapter discovers `custom:taba7-dashboard-shell` cards with a `pages` array. The extended shell must advertise `static supportsEmbeddedCards = true`, render `page.card` using HA's `loadCardHelpers().createCardElement`, forward `hass`, and size the embedded slot. The installer sets `embedded: true` and `embed_mode: shell`. The host sets `--sigen-embedded-height` to its available height and `--sigen-sticky-offset: 0px` when it owns scrolling. The Test copy of Tab A7 has this extension; production shell code is unchanged. The personal shell/configuration is not bundled in this repository.

The installer never assumes an arbitrary third-party shell can display a card. Add a reviewed adapter to `dashboardEmbedTargets` and `embedDashboardCard` when supporting another shell.

## One Settings home

The main navigation is Overview, Energy, Charts, Devices and Settings. Settings groups are Energy, Connections & data, Appearance, System & safety, Service and About. Existing overview shortcuts open the same editors. Scene, day/night and layout choices live in Appearance; test preview badges require `show_preview_controls: true`.

Phone views use readable power tiles under the scene instead of overlaying small labels. All three scene choices retain the same controls and detail destinations. Larger layouts keep the scene and summary side by side when space allows.

Connection setup renders the integration's native HA options flow inside TC. Credentials stay transient in the form and are submitted only to HA's options API. Cancel closes that flow. Account time/date/number/week-start preferences use HA's native per-user frontend storage; security and account management remain in HA's account page. A reload may be needed for HA itself to apply locale preferences.

Operational drafts are shared within HA under the configured integration entry, using native frontend system storage. Saving a draft does not activate a plant command or strategy. Appearance and chart selections remain browser-local. Existing browser-only drafts remain readable as a fallback and become shared when saved; no automatic overwrite of another client's draft occurs.

Charts share one sticky date/period selector and category navigation. Individual chart expansion and standalone cards remain available.


## Standalone card library

The installer has a **Card content** chooser. Select the full dashboard, a summary/control/device card, or any individual chart before choosing its destination. The same views are exposed by the native Home Assistant Sigenergy TC card configuration form. Select the integration entry to discover its sensors automatically; advanced YAML mappings remain supported.

There are 24 view presets and 26 individual chart choices. Useful combinations include:

- Phone: Live power tiles, Compact battery controls, Today's energy, Solar forecast summary.
- Tablet: Live power tiles beside Energy & battery rings, separate Battery / AC / DC cards, Power metrics chart.
- Existing desktop dashboard: Mode & strategies, Connection status, separate device charts and forecast.

Cards respond to their own available width, including when nested in a normal HA Sections layout. Control layouts support Auto, Horizontal (wraps when needed), and Vertical; Comfortable or Compact density retains touch-sized controls. The Battery card can include optional battery controls. AC/DC cards provide daily energy, charging controls and a history shortcut. Charger commands and plant writes retain the integration's existing locks.

Individual charts have their own date/period selector, legend, expansion, recorded-value table and CSV download. They do not require the full dashboard. For YAML, for example:

```yaml
type: custom:sigen-hybrid-card
config_entry: YOUR_SIGENERGY_TC_ENTRY
view: chart
chart_kind: solar
card_layout: compact
```

```yaml
type: custom:sigen-hybrid-card
config_entry: YOUR_SIGENERGY_TC_ENTRY
view: quick_controls
controls_layout: auto
density: comfortable
```

Use the configuration form's integration selector to choose the actual entry. No household identifiers are distributed in these examples.

## Theme and house lighting

Panels, charts and dialogs follow Home Assistant light/dark mode. House lighting (Auto, Day, Night or Home Assistant theme) only selects the house scene. A daylight house therefore stays compatible with dark dashboard charts, and selecting a night scene does not force a dark interface when HA is in light mode.
