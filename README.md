# Mushroom MeshCore Card

Mushroom-inspired [Home Assistant](https://www.home-assistant.io/) Lovelace cards for the [MeshCore](https://meshcore.co.uk) integration.

This project is a fork of [jpettitt/meshcore-card](https://github.com/jpettitt/meshcore-card). It keeps the original card's automatic MeshCore discovery and configuration model while presenting remote nodes and repeaters in a compact, theme-aware layout that fits naturally beside Mushroom Cards.

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

## Use alongside the original card

The fork deliberately uses different resource and custom-element names, so both packages can be loaded at the same time:

```yaml
resources:
  - url: /hacsfiles/meshcore-card/meshcore-card.js
    type: module
  - url: /hacsfiles/mushroom-meshcore-card/mushroom-meshcore-card.js
    type: module
```

Use `custom:meshcore-card` for upstream and `custom:mushroom-meshcore-card` for this fork. Existing upstream configuration remains compatible after changing the card `type`.

## Main card

```yaml
type: custom:mushroom-meshcore-card
```

With no additional YAML, the card discovers MeshCore hubs and remote devices from Home Assistant's entity and device registries.

Remote nodes show a compact header, online state, last-seen age, RSSI, SNR, battery, voltage, sent/received traffic, and optional temperature. Repeaters retain their extended diagnostics, location, telemetry, and neighbour list under a collapsed **Details** control. Offline nodes collapse to their identity, status, type, and last-seen age instead of displaying unavailable metrics.

### Configuration

All existing options remain available through YAML and the visual editor:

```yaml
type: custom:mushroom-meshcore-card
hubs:
  55733c:
    enabled: true
    battery_entity: sensor.example_battery
    voltage_entity: sensor.example_voltage
nodes:
  Spring Farm:
    enabled: true
    battery_entity: sensor.example_battery
    voltage_entity: sensor.example_voltage
    location_entity: sensor.example_location
    temperature_entity: sensor.example_temperature
    humidity_entity: sensor.example_humidity
    illuminance_entity: sensor.example_illuminance
    pressure_entity: sensor.example_pressure
    show_neighbors: true
    max_neighbors: 10
nodes_order:
  - Spring Farm
  - Oakdale
map_provider: meshmapper
map_metro: smf
grid_options:
  rows: 4
```

The per-hub and per-node entries also accept `true` or `false` as show/hide shorthand. Entity overrides are optional; automatic, device-scoped matching remains the default.

## Contact card

```yaml
type: custom:mushroom-meshcore-contact-card
max_contact_age_days: 7
show_path: true
map_provider: meshmapper
map_metro: smf
grid_options:
  rows: 4
```

The contact card discovers `binary_sensor.meshcore_*_contact` entities, sorts them by the most recent advertisement, and preserves its location and optional routing-path support.

## Channel card

```yaml
type: custom:mushroom-meshcore-channel-card
grid_options:
  rows: 4
```

The channel card discovers MeshCore message-channel entities and sorts them by channel index.

## Theme and Card Mod compatibility

The cards inherit Mushroom variables such as `--mush-card-primary-font-size`, `--mush-card-secondary-font-size`, `--mush-chip-height`, `--mush-chip-border-radius`, and `--mush-icon-size`, with Home Assistant theme fallbacks.

The main surface also exposes scoped variables that can be set from a theme or Card Mod:

```css
--mushroom-meshcore-card-padding
--mushroom-meshcore-node-spacing
--mushroom-meshcore-node-radius
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
```

The production bundle is written to `dist/mushroom-meshcore-card.js`.

## License

MIT
