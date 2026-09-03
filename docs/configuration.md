# Configuration reference

All five cards and the Status badge have visual editors, but every setting is also available in YAML. The Main, Channel, Mentions, and Status surfaces begin with their required target; the Releases card begins with its explicit source list. Start with [Getting started](/getting-started), or see the focused guides for the [Main card](/cards/main), [Channel card](/cards/channel), [Mentions card](/cards/mentions), [Releases card](/cards/releases), and [Status card and badge](/cards/status).

## Main card

Each `custom:mushroom-meshcore-card` instance requires exactly one `target` and renders only that hub or node.

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

The visual editor is the safest way to obtain the exact target ID. A missing or unresolved target produces a configuration prompt; the card never selects the first discovered device. Legacy `hubs`, `nodes`, and `nodes_order` fields are ignored.

### Main-card fields

| Field | Type | Default | Applies to | Behavior |
| --- | --- | --- | --- | --- |
| `type` | string | required | both | Must be `custom:mushroom-meshcore-card`. |
| `target` | object | required | both | `{ type: hub, id: <pubkey> }` or `{ type: node, id: <discovered name> }`. |
| `name` | string | discovered name | both | Overrides the Tile header name. |
| `icon` | string | target-appropriate icon | both | Home Assistant icon such as `mdi:radio-tower`. |
| `icon_color` | string | semantic online color | both | Recolors an online target only. Offline and unknown states remain muted. |
| `tap_action` | action | `more-info` | both | Header tap action. |
| `hold_action` | action | `none` | both | Header hold action. |
| `double_tap_action` | action | `none` | both | Header double-tap action. |
| `hide_battery` | boolean | `false` | both | Hides the battery percentage, voltage, and bar. |
| `hide_metrics` | boolean | `false` | node | Hides the RSSI, SNR, and noise-floor metric tiles. |
| `hide_signal_graphs` | boolean | `false` | node | Keeps the signal metric tiles but hides their six-hour Recorder history lines. |
| `hide_details` | boolean | `false` | both | Removes the Details disclosure entirely. |
| `details_default_open` | boolean | `false` | both | Opens Details on the first render. User disclosure state is then preserved. |
| `chip_layout` | object | target defaults | both | Ordered `top`, `details`, and `hidden` chip arrays. See [Chip layout and metrics](/chips). |
| `hide_quick_stats` | boolean | `false` | both | Legacy compatibility option. With no `chip_layout`, moves all default top chips to hidden. |
| `show_firmware` | boolean | `false` | node | Legacy compatibility option. With no `chip_layout`, adds node firmware to the start of the top row. |
| `battery_entity` | entity ID | automatic discovery | both | Flat override for battery percentage. |
| `voltage_entity` | entity ID | automatic discovery | both | Flat override for battery voltage. |
| `location_entity` | entity ID | automatic discovery | node | Reads `latitude` and `longitude` attributes from the selected entity. |
| `temperature_entity` | entity ID | automatic discovery | node | Flat override for temperature. |
| `humidity_entity` | entity ID | automatic discovery | node | Flat override for humidity. |
| `illuminance_entity` | entity ID | automatic discovery | node | Flat override for illuminance. |
| `pressure_entity` | entity ID | automatic discovery | node | Flat override for pressure. |
| `show_neighbors` | boolean | `true` | node | Set to `false` to hide the neighbour chip and disable its dialog. |
| `max_neighbors` | number | all | node | Caps dialog rows when it is a finite positive number; the chip still reports the complete 48-hour count. Zero, a negative value, or an omitted value leaves the list uncapped. |
| `map_provider` | `analyzer` or `meshmapper` | `analyzer` | both | Selects LetsMesh Analyzer or a regional MeshMapper instance for location links. |
| `map_metro` | string | none | both | MeshMapper subdomain, for example `smf`. It must match 1–20 lowercase letters, digits, or hyphens after normalization. |
| `grid_options` | object | card defaults | both | Home Assistant Sections-grid sizing. See [Grid options](#grid-options). |

The editor stores false-by-default booleans only when enabled. `show_neighbors` is the inverse: its normal state is enabled, so the editor stores only `show_neighbors: false`. The legacy quick-chip fields are intentionally absent from the current editor; arranging chips writes a complete `chip_layout` and removes both legacy fields.

### Chip layout

```yaml
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
```

The three arrays form an ordered partition of the chips supported by the selected target. The first occurrence of a valid chip ID wins; duplicates and IDs unsupported by that target are ignored. Any supported chip omitted from all three arrays is treated as hidden. A chip assigned to a visible area is still omitted at render time when its backing value is missing, empty, invalid, `unknown`, or `unavailable`.

For the exact target-specific IDs, default order, units, and MeshCore entity aliases, see [Chip layout and metrics](/chips).

### Entity discovery and overrides

Entity overrides are optional. The card normally resolves MeshCore entities through the Home Assistant device and entity registries, scoped to the selected target. Overrides take precedence only for their named reading and remain flat on the card configuration.

For nodes, battery discovery checks `battery_percentage`, then `battery_level`,
then `battery`. Hubs use their `battery_percentage` sensor. An explicit
`battery_entity` override takes precedence for either target. Repeater voltage
prefers the MeshCore HA 2.9 `bat` sensor and falls back to `battery_voltage`.
Environmental readings use the target device's temperature, humidity,
illuminance, and pressure sensors.

`location_entity` is useful when a node's coordinates live on another MeshCore entity. It must expose numeric, non-zero `latitude` and `longitude` attributes. Without an override, the card uses the node's contact attributes or its device-scoped latitude and longitude sensors. Metrics and coordinates that cannot be resolved are omitted rather than displayed as unavailable.

### Maps

LetsMesh Analyzer is the default:

```yaml
map_provider: analyzer
```

MeshMapper requires a regional metro subdomain:

```yaml
map_provider: meshmapper
map_metro: smf
```

The card lowercases and trims `map_metro`. If the provider is not exactly
`meshmapper`, or the metro does not match the card's 1–20 character
letters/digits/hyphens pattern, the link falls back to LetsMesh Analyzer. A map
link appears only when both coordinates are valid.

### Neighbours

The `neighbor_count` chip and its dialog include only neighbours provably heard during MeshCore's rolling 48-hour window. Selecting the chip opens the dialog; selecting an entity-backed row opens that entity's more-info dialog. `max_neighbors` affects only the number of visible rows, sorted by SNR, not the count shown on the card.

## Channel card

Each `custom:mushroom-meshcore-channel-card` requires one existing MeshCore channel message entity.

```yaml
type: custom:mushroom-meshcore-channel-card
entity: binary_sensor.meshcore_edfaf6_ch_0_messages
```

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | string | required | Must be `custom:mushroom-meshcore-channel-card`. |
| `entity` | entity ID | required | Existing entity matching `binary_sensor.meshcore_*_ch_<n>_messages`. |
| `name` | string | discovered channel name | Overrides the Tile header name. |
| `icon` | string | `mdi:message-bulleted` | Overrides the Tile header icon. |
| `icon_color` | string | semantic active color | Recolors the icon while the target is active. |
| `tap_action` | action | `more-info` | Header tap action. |
| `hold_action` | action | `none` | Header hold action. |
| `double_tap_action` | action | `none` | Header double-tap action. |
| `hide_timestamps` | boolean | `false` | Hides the time on each message without changing grouping or order. |
| `hide_date_headers` | boolean | `false` | Hides Today, Yesterday, and dated group headings. |
| `hide_route_details` | boolean | `false` | Hides live hop, path, and scope enrichment. Routing events continue to populate the per-user cache. |
| `hide_links` | boolean | `false` | Renders `http(s)` URLs as plain text instead of links. |
| `hours_to_show` | number | `24` | Positive number of Logbook history hours to request. Invalid values fall back to 24. |
| `max_messages` | number | `200` | Positive maximum retained rows, floored to an integer. Invalid values fall back to 200. |
| `grid_options` | object | card defaults | Home Assistant Sections-grid sizing. |

`hours_to_show` and `max_messages` control only the visible Logbook history. The shared route cache has its own bounded retention. For routing, cache, permission, and security behavior, see the [Channel card guide](/cards/channel).

## Mentions card

The Mentions card reads the Local To-do entity written by the bundled automation blueprint.

```yaml
type: custom:mushroom-meshcore-mentions-card
entity: todo.meshcore_mentions
```

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | string | required | Must be `custom:mushroom-meshcore-mentions-card`. |
| `entity` | entity ID | required | Existing `todo.*` entity used by the mentions automation. |
| `name` | string | `Mentions` | Overrides the Tile header name. |
| `icon` | string | `mdi:at` | Overrides the Tile header icon. |
| `icon_color` | string | semantic active color | Recolors the icon when unhandled mentions exist. |
| `tap_action` | action | `more-info` | Header tap action. |
| `hold_action` | action | `none` | Header hold action. |
| `double_tap_action` | action | `none` | Header double-tap action. |
| `hide_completed` | boolean | `true` | Hides handled items. Set to `false` to show and reopen them. |
| `hide_timestamps` | boolean | `false` | Hides item times without changing date grouping or order. |
| `hide_date_headers` | boolean | `false` | Hides date headings, including Earlier mentions. |
| `hide_links` | boolean | `false` | Renders `http(s)` URLs as plain text instead of links. |
| `grid_options` | object | card defaults | Home Assistant Sections-grid sizing. |

Card installation and blueprint import are separate. Follow the [Mentions card guide](/cards/mentions) and [MeshCore Mentions blueprint](/mentions-blueprint) before selecting the To-do entity.

## Releases card

The Releases card reads an explicit list of Home Assistant release sensors.

```yaml
type: custom:mushroom-meshcore-releases-card
sources:
  - entity: sensor.meshcore_latest_release
    name: MeshCore
  - entity: sensor.mishmesh_latest_release
    name: mishmesh
```

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | string | required | Must be `custom:mushroom-meshcore-releases-card`. |
| `sources` | list | required | Explicit `{ entity, name? }` release sensor entries. Duplicate entities keep their first entry. |
| `name` | string | `Software releases` | Overrides the Tile header name. |
| `icon` | string | `mdi:download` | Overrides the Tile header icon. |
| `icon_color` | string | `primary` | Recolors the neutral header icon. |
| `sort` | `newest`, `configured`, or `name` | `newest` | Controls row ordering. Matching or missing dates retain configured order. |
| `hide_age` | boolean | `false` | Hides relative ages and the newest-age header summary. |
| `grid_options` | object | card defaults | Home Assistant Sections-grid sizing. |

The entity state supplies the tag. `html_url`, `published_at`, and `prerelease`
attributes supply the link, age, and optional badge. Missing entities remain as
muted rows; unsafe or non-HTTPS links are never opened. Follow the
[Releases card guide](/cards/releases) for the complete sensor contract and
REST examples.

## Status card and badge

The Status card and badge each require one explicit hub target and share the
same network-health result. Only registry-backed managed child nodes belonging
to that hub are counted; discovered contacts are not part of the denominator.

```yaml
type: custom:mushroom-meshcore-status-card
target:
  type: hub
  id: 55733c
```

Use the companion badge at the top of a normal dashboard view:

```yaml
type: custom:mushroom-meshcore-status-badge
target:
  type: hub
  id: 55733c
```

### Shared Status fields

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | string | required | Must be `custom:mushroom-meshcore-status-card` or `custom:mushroom-meshcore-status-badge`. |
| `target` | object | required | `{ type: hub, id: <pubkey> }`. The surface never selects another hub. |
| `name` | string | discovered hub name | Overrides the header or badge label. |
| `icon` | string | `mdi:access-point-network` | Overrides the header or badge icon. |
| `icon_color` | string | semantic healthy color | Recolors only a healthy state; warning, critical, and unknown keep semantic colors. |
| `tap_action` | action | card: `more-info`; badge: status dialog | Primary action. An explicit badge action replaces its details dialog. |
| `hold_action` | action | `none` | Hold action. |
| `double_tap_action` | action | `none` | Double-tap action. |
| `low_battery_threshold` | number | `50` | Percentage from 0 to 100. A valid reading strictly below this value creates a warning; invalid YAML falls back to 50. |
| `excluded_nodes` | string list | none | Discovered managed-node names removed from the total and health result. Matching is trimmed and case-insensitive. |
| `status_entity` | entity ID | automatic discovery | Authoritative flat override for the selected hub's connection state. |
| `battery_entity` | entity ID | automatic discovery | Authoritative flat override for the selected hub's battery percentage. |

### Status-card-only fields

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `hide_monitored_nodes` | boolean | `false` | Removes the Monitored nodes disclosure. |
| `monitored_nodes_default_open` | boolean | `false` | Opens Monitored nodes on first render; subsequent user state is preserved. |
| `hide_diagnostics` | boolean | `false` | Removes the neutral Diagnostics disclosure. |
| `diagnostics_default_open` | boolean | `false` | Opens Diagnostics on first render; subsequent user state is preserved. |
| `grid_options` | object | card defaults | Home Assistant Sections-grid sizing. The badge does not use grid options. |

Changing the selected hub in either visual editor clears `excluded_nodes`,
`status_entity`, and `battery_entity`. Appearance, interactions, threshold, and
card disclosure preferences are preserved.

The default 50% battery threshold does not warn at exactly 50%. A hub value of
zero follows the main card's mains-powered convention; a node value of zero is
a valid low reading. Offline nodes are not evaluated from cached battery data,
and voltage is never converted to percentage.

Exclusions use display names rather than immutable IDs. A rename can stop an
entry from matching. One entry excludes every same-named managed node under the
hub and produces an editor collision warning. See the
[Status guide](/cards/status#excluding-managed-nodes) before relying on a
long-lived exclusion list.

Missing optional MQTT, battery, and diagnostic entities mean the check is not
supported and do not count as problems. Present but unavailable checks add to
the unknown count. When the hub is offline or unknown, downstream checks are
paused rather than interpreted from stale data.

## Header actions

The three header action fields accept this Home Assistant-compatible subset:

| `action` | Additional fields | Result |
| --- | --- | --- |
| `more-info` | none | Opens the selected target's primary entity. This is the default card tap behavior. |
| `navigate` | `navigation_path` | Navigates within Home Assistant. |
| `url` | `url_path` | Opens the URL. |
| `perform-action` | `perform_action`, optionally `data` and `target` | Calls a Home Assistant action such as `light.turn_on`. |
| `call-service` | `service`, optionally `data` (or legacy `service_data`) and `target` | Legacy spelling retained for compatible YAML. `data` wins when both data fields are supplied. |
| `none` | none | Disables that gesture. |

`target` may contain `entity_id`, `device_id`, or `area_id`, each as a string or list. Any non-`none` action can include `confirmation: true` or a custom prompt:

```yaml
hold_action:
  action: perform-action
  perform_action: switch.turn_off
  target:
    entity_id: switch.meshcore_power
  confirmation:
    text: Turn off the MeshCore radio?
```

The hold threshold is 500 ms. Configuring a double-tap action introduces a 250 ms delay before a single tap is executed so the second tap can be detected.

Header actions do not replace entity-specific controls. Metrics, battery values, and entity-backed chips open their own more-info dialogs; the neighbour-count chip opens its recent-neighbours dialog. The Status badge is the exception to the default tap: with no explicit `tap_action`, it opens its compact health-details dialog. Any explicit action, including `none`, replaces that dialog.

### Icon colors

`icon_color` accepts Home Assistant/Mushroom color names such as `blue`, `deep-purple`, and `orange`, plus `primary`, `accent`, strict hex colors, `rgb()`/`rgba()`/`hsl()`/`hsla()` colors, and CSS named colors. Unsafe or malformed CSS is ignored. The override is applied only while the target is active or online so unavailable states retain their semantic muted appearance.

## Grid options

All cards preserve Home Assistant's native Sections-dashboard `grid_options` object:

| Field | Accepted values | Purpose |
| --- | --- | --- |
| `columns` | number or `full` | Requested column span. |
| `rows` | number or `auto` | Requested row span. A numeric value places the card in fixed-height mode. |
| `min_columns` / `max_columns` | number | Optional editor sizing limits. |
| `min_rows` / `max_rows` | number | Optional editor sizing limits. |

The defaults advertised to Home Assistant are:

| Card | Columns | Rows | Minimum columns | Minimum rows |
| --- | --- | --- | --- | --- |
| Main | `full` | `auto` | 6 | 1 |
| Channel | `full` | 8 | 6 | 4 |
| Mentions | `full` | `auto` | 6 | 1 |
| Releases | `full` | `auto` | 6 | 1 |
| Status | `full` | `auto` | 6 | 2 |

With numeric `rows`, the main card clips content that falls outside its allocated height, while Channel, Mentions, Releases, and Status use an internal scrolling content area. Increase the row count or return to `rows: auto` if expected content is not visible.

## Examples

Copyable YAML examples for each surface live in the [Main card](/cards/main), [Channel card](/cards/channel), [Mentions card](/cards/mentions), [Releases card](/cards/releases), and [Status card and badge](/cards/status) guides. See [Troubleshooting](/troubleshooting) when a target, source, or metric is not found.
