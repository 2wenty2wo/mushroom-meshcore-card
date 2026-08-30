<h1 align="center">
  <img src="https://raw.githubusercontent.com/2wenty2wo/mushroom-meshcore-card/main/assets/logo.png" alt="Mushroom MeshCore Card" width="140"><br>
  Mushroom MeshCore Card
</h1>

<div align="center">

Mushroom and Tile styled [Home Assistant](https://www.home-assistant.io/) Lovelace cards for the [MeshCore](https://meshcore.io) integration.

This project is a fork of [jpettitt/meshcore-card](https://github.com/jpettitt/meshcore-card).

[![CI](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml/badge.svg)](https://github.com/2wenty2wo/mushroom-meshcore-card/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/2wenty2wo/mushroom-meshcore-card/branch/main/graph/badge.svg)](https://codecov.io/gh/2wenty2wo/mushroom-meshcore-card)
[![GitHub Release](https://img.shields.io/github/v/release/2wenty2wo/mushroom-meshcore-card?style=flat&label=release)](https://github.com/2wenty2wo/mushroom-meshcore-card/releases)
[![License](https://img.shields.io/github/license/2wenty2wo/mushroom-meshcore-card?style=flat&label=license)](LICENSE)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange?style=flat)](https://hacs.xyz)

</div>

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

![Mushroom MeshCore Main Card](screenshots/main-card.png)

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
```

Each main-card instance displays one selected hub or remote node. Add the card through the dashboard editor, select a MeshCore device, and repeat for every device you want to place independently.

Remote nodes show a Tile-style header, online state, last-seen age, RSSI, SNR, available noise-floor data, battery percentage and voltage, sent/received traffic, uptime, and optional temperature. Repeaters retain their extended diagnostics, location, telemetry, and neighbour list under a collapsed **Details** control. Hubs share the same body primitives: a battery block, hardware/firmware quick chips, and RF, location, MQTT, and other diagnostics under the same **Details** control. Offline devices collapse to their identity and last-seen status with a badge on the icon, while their card surface fills the row allocated by a Sections dashboard.

### Configuration

The visual editor includes a drag-and-drop chip organizer with ordered **Top**, **Details**, and **Hidden** areas, alongside Mushroom-style Appearance, Interactions, and entity-override sections. Every drag operation has equivalent destination and order controls for keyboard use. Entity overrides remain optional because device-scoped automatic matching is the default.

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
hide_details: false
details_default_open: false
chip_layout:
  top:
    - sent
    - received
    - temperature
    - uptime
    - neighbor_count
  details:
    - route
    - path_length
    - frequency
    - bandwidth
  hidden:
    - firmware
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

`tap_action`, `hold_action`, and `double_tap_action` accept the standard Home Assistant action config (`more-info`, `navigate`, `url`, `perform-action`, `none`), including the optional `confirmation:` prompt, and apply to the device header. Individual metrics and entity-backed chips open their own entity's more-info dialog, except the neighbour-count chip, which opens the recent-neighbours list. `icon_color` accepts the Mushroom/Tile color names (`red`, `blue`, `deep-purple`, …) or a plain CSS color (`#rrggbb`, `rgb(…)`, `hsl(…)`, named colors), and applies while the device is online.

The editor writes a complete `chip_layout`; chips omitted from all three YAML lists are treated as hidden. Existing configurations without `chip_layout` retain their current quick-chip behavior, including the legacy `hide_quick_stats` and `show_firmware` options. The neighbour count and list include only neighbours provably heard within the integration's rolling 48-hour window. The top neighbour chip shows the icon and count only; selecting it opens the same neighbour list shown under Details. `show_neighbors: false` hides both, while `max_neighbors` limits the visible rows in Details and the popup without changing the reported total.

Hub cards use the same public card type:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: hub
  id: 55733c
battery_entity: sensor.example_battery
voltage_entity: sensor.example_voltage
```


## Channel card

![Mushroom MeshCore Channel Card](screenshots/channel-card.png)

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

## Mentions card

![Mushroom MeshCore Mentions Card](screenshots/mentions-card.png)

The Mentions card uses the bundled **MeshCore Mentions** automation blueprint to detect tags and write them to a Local To-do list. Home Assistant 2026.5.0 or later is required for the blueprint. Import it, create an automation from it, and then select the same Local To-do entity in the card.

[![Import the MeshCore Mentions blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2F2wenty2wo%2Fmushroom-meshcore-card%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmeshcore%2Fmention_notifications.yaml)

Installing the dashboard card through HACS and importing the automation blueprint are separate steps: HACS installs the frontend resource, while the blueprint runs the background mention detection and optional notifications.

1. Create a new **Local To-do** list named **MeshCore Mentions** and keep it dedicated to mention records rather than personal tasks.
2. Import the blueprint above and create an automation from it.
3. Enter the companion names that should count as mentions, select the new **MeshCore Mentions** entity, and optionally select notification entities.
4. Add the Mentions card and select that same **MeshCore Mentions** entity.

```yaml
type: custom:mushroom-meshcore-mentions-card
entity: todo.meshcore_mentions
icon: mdi:at
icon_color: orange
hide_completed: true
hide_timestamps: false
hide_date_headers: false
tap_action:
  action: more-info
hold_action:
  action: none
double_tap_action:
  action: none
grid_options:
  columns: full
```

Each item written as `sender on channel: message` is shown as a structured sender, channel, and message row. Blueprint-created items also carry their received time, allowing the card to group them by date and show Channels-style timestamps. Items without that metadata remain available under **Earlier mentions**. Use the checkbox to mark a mention handled; turn off **Hide handled mentions** to view handled items and reopen one.

See the [MeshCore Mentions blueprint guide](docs/mentions-blueprint.md) for complete setup, testing, and troubleshooting details.


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

## License

MIT
