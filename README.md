<p align="center">
  <img src="assets/logo.svg" alt="Mushroom MeshCore Card" width="140">
  <h1 align="center">Mushroom MeshCore Card</h1>
</p>

Mushroom and Tile styled [Home Assistant](https://www.home-assistant.io/) Lovelace cards for the [MeshCore](https://meshcore.co.uk) integration.

This project is a fork of [jpettitt/meshcore-card](https://github.com/jpettitt/meshcore-card).

[![CI](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml/badge.svg)](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/release/2wenty2wo/mushroom-meshcore-card.svg?style=for-the-badge)](https://github.com/2wenty2wo/mushroom-meshcore-card/releases)
[![License](https://img.shields.io/github/license/2wenty2wo/mushroom-meshcore-card.svg?style=for-the-badge)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://hacs.xyz)

## Requirements

- Home Assistant 2023.x or later
- [MeshCore Integration](https://github.com/meshcore-dev/meshcore-ha), installed and configured

Mushroom and Card Mod are optional. The card uses their public theme conventions when available but has Home Assistant fallbacks and works independently.

## Installation

### HACS

1. Open **HACS → Frontend**.
2. Open the ⋮ menu and choose **Custom repositories**.
3. Add `https://github.com/2wenty2wo/mushroom-meshcore-card` as a **Dashboard** repository.
4. Install **Mushroom MeshCore Card**.
5. Reload the browser.

[![Add Repository](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=2wenty2wo&repository=mushroom-meshcore-card&category=plugin)

### Manual

1. Download `mushroom-meshcore-card.js` from the latest [release](https://github.com/2wenty2wo/mushroom-meshcore-card/releases).
2. Copy it to `config/www/mushroom-meshcore-card.js`.
3. Add `/local/mushroom-meshcore-card.js` under **Settings → Dashboards → Resources** as a JavaScript module.
4. Reload the browser.


## Main card

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
```

Each main-card instance displays one selected hub or remote node. Add the card through the dashboard editor, select a MeshCore device, and repeat for every device you want to place independently.

Remote nodes show a Tile-style header, online state, last-seen age, RSSI, SNR, available noise-floor data, battery percentage and voltage, sent/received traffic, uptime, and optional temperature. A repeater's last reported firmware version can be enabled as a quick-stat pill with `show_firmware: true`; it is hidden by default. Repeaters retain their extended diagnostics, location, telemetry, and neighbour list under a collapsed **Details** control. Hubs share the same body primitives: a battery block, hardware/firmware quick chips, and RF, location, MQTT, and other diagnostics under the same **Details** control. Offline devices collapse to their identity and last-seen status with a badge on the icon, while their card surface fills the row allocated by a Sections dashboard.

### Configuration

The visual editor groups settings into Mushroom-style Appearance, Interactions, and entity-override sections, and exposes only the settings relevant to the selected device. Entity overrides remain optional because device-scoped automatic matching is the default.

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
name: Spring Farm Repeater
icon: mdi:radio-tower
icon_color: blue
tap_action:
  action: more-info
hold_action:
  action: navigate
  navigation_path: /lovelace/mesh
double_tap_action:
  action: none
hide_battery: false
hide_metrics: false
hide_quick_stats: false
show_firmware: false
hide_details: false
details_default_open: false
battery_entity: sensor.example_battery
voltage_entity: sensor.example_voltage
location_entity: sensor.example_location
temperature_entity: sensor.example_temperature
humidity_entity: sensor.example_humidity
illuminance_entity: sensor.example_illuminance
pressure_entity: sensor.example_pressure
show_neighbors: true
max_neighbors: 10
map_provider: meshmapper
map_metro: smf
grid_options:
  rows: 4
```

`tap_action`, `hold_action`, and `double_tap_action` accept the standard Home Assistant action config (`more-info`, `navigate`, `url`, `perform-action`, `none`), including the optional `confirmation:` prompt, and apply to the device header; individual metrics and chips always open their own entity's more-info dialog. `icon_color` accepts the Mushroom/Tile color names (`red`, `blue`, `deep-purple`, …) or a plain CSS color (`#rrggbb`, `rgb(…)`, `hsl(…)`, named colors), and applies while the device is online.

Hub cards use the same public card type:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: hub
  id: 55733c
battery_entity: sensor.example_battery
voltage_entity: sensor.example_voltage
```

### Migrating grouped main cards

The grouped `hubs`, `nodes`, and `nodes_order` fields are no longer rendered. Duplicate or add the main card once per device, select its target in the visual editor, and move any applicable entity overrides to the flat fields shown above. A card without a valid `target` displays a migration prompt rather than selecting a device automatically.

## Channel card

```yaml
type: custom:mushroom-meshcore-channel-card
entity: binary_sensor.meshcore_edfaf6_ch_0_messages
name: Public
icon: mdi:message-bulleted
icon_color: green
tap_action:
  action: more-info
hold_action:
  action: none
double_tap_action:
  action: none
hide_timestamps: false
hide_date_headers: false
hours_to_show: 24
max_messages: 200
grid_options:
  columns: full
  rows: 8
```

Each channel card requires one `binary_sensor.meshcore_*_ch_<n>_messages` entity. It uses Home Assistant's live Logbook stream to show that channel as a newest-first, scrollable conversation beneath the same Tile-style header used by the main card. The channel prefix is removed from each row, the sender before the first colon is emphasised, and later colons and line breaks remain part of the message.

The history defaults to 24 hours and at most 200 messages. Dates and timestamps are visible by default and can be hidden independently. `name`, `icon`, `icon_color`, all three Tile actions, history settings, and `grid_options` can be configured in YAML or the visual editor.


## Theme and Card Mod compatibility

The main device header uses Home Assistant's native Tile icon and information primitives. The current [Mushroom source](https://github.com/piitaya/lovelace-mushroom) and its [theme definitions](https://github.com/piitaya/lovelace-mushroom/blob/main/src/utils/theme.ts) remain the source of truth for the composite metrics, chips, and controls below it.

The cards inherit Mushroom variables such as `--mush-card-primary-font-size`, `--mush-card-secondary-font-size`, `--mush-chip-height`, `--mush-chip-border-radius`, and `--mush-icon-size`, with Home Assistant theme fallbacks. The community [Mushroom Card Mod guide](https://community.home-assistant.io/t/mushroom-cards-card-mod-styling-config-guide/600472) is a useful customization reference, but its selectors and examples are version-sensitive.

The main surface also exposes scoped variables that can be set from a theme or Card Mod:

```css
--mushroom-meshcore-card-padding
--mushroom-meshcore-surface
--mushroom-meshcore-success-color
--mushroom-meshcore-warning-color
--mushroom-meshcore-danger-color
```

Card Mod is never required for the core layout or state styling.

## Localisation

The cards use the active Home Assistant language and include English, French, Dutch, German, and Polish translations.

## Development

```bash
npm ci
npm run typecheck
npm run check-translations
npm run build
npm run test:render
```

The production bundle is written to `dist/mushroom-meshcore-card.js`.

## License

MIT
