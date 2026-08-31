# Main card

The main card displays exactly one selected MeshCore hub or remote node. Add
separate card instances when you want to position several devices independently
on a dashboard.

![Mushroom MeshCore Main Card](../../screenshots/main-card.png)

## Quick start

For a remote node, use the exact discovered device name:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
```

For a hub, use its discovered public-key identifier:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: hub
  id: 55733c
```

The visual editor lists valid hubs and nodes and is the safest way to choose a
target. A missing or unresolved target produces a configuration prompt; the
card never chooses the first discovered device on your behalf.

## What the card shows

Remote nodes use a Tile-style identity header followed by available telemetry.
Depending on the selected device and the entities exposed by MeshCore HA, that
can include online state, last-seen age, RSSI, SNR, noise floor, battery
percentage and voltage, sent and received traffic, uptime, temperature,
location, and repeater diagnostics. Unknown, unavailable, empty, and invalid
numeric states are omitted rather than displayed as useful readings.

Repeater diagnostics are organized under a **Details** disclosure into Device,
Network, Radio, Network Traffic, Airtime, Message Rates, Reliability, and
Telemetry groups. Groups with no valid readings are omitted. Raw RSSI and SNR
remain visible without applying invented RF-quality labels.

Hub cards use the same header and body primitives for battery, hardware,
firmware, RF settings, location, MQTT state, and other available diagnostics.
An offline node collapses to a short identity and last-seen summary rather than
showing unavailable metrics.

## Complete node example

This example demonstrates every current main-card setting intended for a node.
Replace the target and optional entity overrides with identifiers from your own
Home Assistant instance.

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
  columns: full
  rows: 4
```

Entity overrides are optional. By default, the card matches supporting entities
to the selected MeshCore device through Home Assistant's registries. Overrides
are useful when telemetry comes from another integration or an entity has an
unusual name. `location_entity` must provide usable `latitude` and `longitude`
attributes.

See the [configuration reference](/configuration) for field types, defaults,
target-specific availability, and all supported Home Assistant actions.

## Header and actions

`name`, `icon`, and `icon_color` override the discovered identity. The icon
color is applied while the device is online; offline and unavailable states
retain their muted semantic treatment.

`tap_action`, `hold_action`, and `double_tap_action` apply to the primary
header. The default tap opens more-info for the selected device's primary
entity, while hold and double-tap default to no action. Entity-backed metrics
and chips always open their own more-info dialog. The neighbour-count chip is
the exception: it opens the recent-neighbours dialog.

## Arrange chips

The visual editor provides ordered **Top**, **Details**, and **Hidden** areas,
including keyboard destination and ordering controls. The equivalent YAML is
`chip_layout`.

When `chip_layout` is present, it is a complete partition: any supported chip
omitted from all three lists is treated as hidden. Remove `chip_layout` to
restore the defaults. Configurations created before the organizer remain
compatible through the legacy `hide_quick_stats` and `show_firmware` fields,
but moving a chip in the current editor replaces those fields with a complete
layout.

Detail chips keep their configured order inside their semantic categories.
Read the [chip reference](/chips) for every node and hub chip ID, including the
MeshCore HA 2.9 repeater metrics and older entity aliases.

## Recent neighbours

For supported repeater nodes, the neighbour count contains only neighbours that
the integration can prove were heard within its rolling 48-hour window.
Selecting the chip opens a list sorted by SNR. Contact names are resolved when
the corresponding MeshCore contact is known; otherwise a shortened identifier
is shown.

- `show_neighbors: false` hides the count and disables the dialog.
- `max_neighbors` limits visible dialog rows without changing the total shown
  on the card.
- Nodes without compatible neighbour entities simply omit this feature.

## Map links

When the selected device has valid coordinates, its location section includes
an external map link. The default provider is LetsMesh Analyzer. To use a
regional MeshMapper instance, set both values:

```yaml
map_provider: meshmapper
map_metro: smf
```

The metro becomes a MeshMapper subdomain and must match the card's 1–20
character letters/digits/hyphens pattern. Missing or non-matching values fall
back to LetsMesh Analyzer.
External links open in a new tab with opener access disabled.

## Fixed dashboard rows

The card naturally requests full width and automatic height in a Sections
dashboard. When `grid_options.rows` is a number, it fills the allocated height
and clips lower content that cannot fit. Give the card more rows or hide/move
content if a fixed-height layout cuts off useful information.

For installation and first-card setup, see [Getting started](/getting-started).
For styling, see [Theming and Card Mod](/theming). For missing targets or
entities, see [Troubleshooting](/troubleshooting).
