# Status card and badge

The Status card and companion badge summarize the health of one MeshCore hub
and the managed nodes associated with it. They use the same health model: the
card is the place to investigate a problem, while the badge keeps the result
visible at the top of a dashboard view.

Both surfaces require an explicit hub target. They never select the first hub
or combine multiple hubs.

## What is monitored

The denominator includes registry-backed managed child devices belonging to
the selected hub. It deliberately excludes ordinary discovered contacts:
portable contacts can be stale, may belong to a different workflow, and can
exist without Home Assistant entities.

Where the MeshCore integration exposes the relevant entities, the health model
checks:

- the selected hub's connection state;
- each managed node's online state;
- MQTT broker connections belonging to the hub;
- valid hub and online-node battery percentages;
- MeshCore radio diagnostic flags.

Optional checks that are not exposed by the selected hub or node are simply
unsupported and do not become warnings. An entity that exists but currently
reports an unavailable, unknown, empty, or unrecognized value contributes to
the separate unknown count.

## Add the card

```yaml
type: custom:mushroom-meshcore-status-card
target:
  type: hub
  id: 55733c
```

The visual editor is the easiest way to obtain the public-key identifier. A
missing or unresolved target renders a configuration prompt rather than using
another hub.

The Tile-style header shows the overall state and managed-node count. The body
groups only the findings that need attention, followed by collapsed
**Monitored nodes** and **Diagnostics** disclosures. A healthy network remains
calm and shows **No active issues** rather than a wall of successful checks.

## Add the badge

Custom dashboard badges require Home Assistant 2024.8 or later. On an earlier
supported Home Assistant version, use the Status card for the same health
model and issue details.

Add a badge to the same view and select the same hub:

```yaml
type: custom:mushroom-meshcore-status-badge
target:
  type: hub
  id: 55733c
```

The badge shows a compact result such as `12/12 online`, `2 issues`,
`2 issues · 1 unknown`, `Hub offline`, or `Unknown`. Its accessible label
contains a fuller issue breakdown, so status does not depend on color alone.

By default, selecting the badge opens a compact details dialog listing only
the issue and unknown groups. Selecting an entity-backed row opens that
entity's Home Assistant more-info dialog. Set an explicit `tap_action` to
replace the status dialog; `tap_action: { action: none }` disables tap.
Hold and double-tap actions remain independently configurable.

Home Assistant badges appear at the top of a view and are not shown in
[Panel view](https://www.home-assistant.io/dashboards/panel/). Use the Status
card when the dashboard uses Panel view or when the status must be part of the
main layout.

## Complete card example

```yaml
type: custom:mushroom-meshcore-status-card
target:
  type: hub
  id: 55733c
name: Farm mesh
icon: mdi:access-point-network
low_battery_threshold: 50
excluded_nodes:
  - Bench Repeater
hide_monitored_nodes: false
monitored_nodes_default_open: false
hide_diagnostics: false
diagnostics_default_open: false
tap_action:
  action: more-info
hold_action:
  action: none
double_tap_action:
  action: none
grid_options:
  columns: full
  rows: auto
```

Entity overrides remain optional and flat:

```yaml
status_entity: sensor.meshcore_55733c_node_status_farm_hub
battery_entity: sensor.meshcore_55733c_battery_percentage_farm_hub
```

An explicit override is authoritative. If it points to a missing or
unavailable entity, that check becomes unknown rather than silently falling
back to another entity.

## Complete badge example

```yaml
type: custom:mushroom-meshcore-status-badge
target:
  type: hub
  id: 55733c
name: Farm mesh
icon: mdi:access-point-network
low_battery_threshold: 50
excluded_nodes:
  - Bench Repeater
tap_action:
  action: navigate
  navigation_path: /lovelace/meshcore
hold_action:
  action: more-info
```

Omit `tap_action` to retain the default status-details dialog.

## Battery threshold

`low_battery_threshold` defaults to 50 and accepts percentages from 0 to 100.
Invalid YAML falls back to 50. A valid battery is considered low only when it
is strictly below the threshold, so a 50% reading is not a warning with the
default setting.

A hub battery reading of zero retains the main card's mains-powered convention
and is not treated as low. A managed node reading of zero is a valid low
battery value. Voltage alone is never converted into a percentage, and an
offline node's cached battery is not assessed until the node is online again.

## Excluding managed nodes

Use `excluded_nodes` for devices that should not affect the monitored total or
health result:

```yaml
excluded_nodes:
  - Bench Repeater
  - Spare Sensor
```

Entries are human-readable discovered node names. Matching is trimmed and
case-insensitive. Because a name is not an immutable device identifier:

- renaming a MeshCore device can stop an existing exclusion from matching;
- if two managed nodes under the same hub share a name, that one entry excludes
  both and the editor reports the collision.

Recheck exclusions after renaming or recreating a device. Changing the
selected hub in the editor clears exclusions and hub entity overrides to avoid
carrying device-specific configuration to the wrong hub.

## Severity and counting

The Status surfaces distinguish active issues from incomplete coverage:

| Result | Meaning |
| --- | --- |
| Critical | The selected hub is explicitly offline. |
| Warning | A managed node is offline, an MQTT broker is disconnected, a valid battery is below the configured threshold, or a radio diagnostic flag is asserted. |
| Unknown | A supported or explicitly configured check exists but cannot currently be assessed. |
| Healthy | No critical or warning findings and no unknown checks remain. |

Each affected node, broker, low battery, or asserted radio flag contributes
one issue. Unknown checks are counted separately. Warning takes precedence in
the headline when both are present, but the unknown count remains visible.

When the hub is offline or unknown, downstream readings may be cached and no
longer trustworthy. The card therefore reports the hub state and pauses node,
MQTT, battery, and radio assessment until the hub can be evaluated again.

## Radio flags and neutral diagnostics

MeshCore's `err_pool_full`, `err_cad_timeout`, and `err_rx_timeout` radio flags
are latched. An asserted flag means the fault was recorded since the radio
last restarted; it does not prove that the fault is happening at this instant.
The Status surfaces use that wording to avoid overstating the condition.

Queue length is a current gauge, while request failures, queue-full events, and
receive-error totals are cumulative counters. The card may show available
gauges, rates, and clearly labelled totals in the neutral **Diagnostics**
disclosure, but a non-zero lifetime total never creates an issue by itself.
The frontend does not query Recorder history or invent a recent-failure window.

## Actions and appearance

The card header and badge support standard `tap_action`, `hold_action`, and
`double_tap_action` configuration. The card's default tap opens more-info for
the selected hub. The badge's default tap is its status-details dialog.

`name`, `icon`, and `icon_color` customize the neutral appearance. The fallback
icon is `mdi:access-point-network`. A configured icon color applies only to a
healthy result; warning, critical, and unknown states keep their semantic or
muted treatment so customization cannot conceal health.

See the [configuration reference](/configuration#status-card-and-badge) for
every field, [Theming and Card Mod](/theming) for stable CSS variables, and
[Troubleshooting](/troubleshooting#status-shows-unknown-or-the-wrong-node-count)
when the result is unexpected.
