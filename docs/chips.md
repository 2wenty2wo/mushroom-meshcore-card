# Chip layout and metrics

The Main card's chip organizer controls three ordered areas:

- **Top** places compact quick chips above the Details disclosure.
- **Details** places labeled chips inside the disclosure and groups adjacent node chips into semantic sections.
- **Hidden** keeps chips out of the rendered card.

The editor supports drag and drop plus keyboard-friendly destination and ordering controls. YAML uses the `chip_layout` object described in the [configuration reference](/configuration#chip-layout).

Inside Details, chips keep their configured order and receive a new category heading whenever adjacent chips belong to different categories. Missing values and empty categories are omitted.

## Default layouts

### Node

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
    - spreading_factor
    - frequency
    - bandwidth
    - tx_power
    - relayed
    - sent_direct
    - sent_flood
    - received_direct
    - received_flood
    - tx_airtime
    - rx_airtime
    - tx_airtime_total
    - rx_airtime_total
    - tx_rate
    - rx_rate
    - sent_direct_rate
    - sent_flood_rate
    - received_direct_rate
    - received_flood_rate
    - direct_duplicates_rate
    - flood_duplicates_rate
    - receive_errors_rate
    - canceled
    - duplicate
    - direct_duplicates
    - flood_duplicates
    - queue_length
    - queue_full_events
    - receive_errors
    - request_successes
    - request_failures
    - humidity
    - illuminance
    - pressure
  hidden:
    - firmware
```

For configurations without `chip_layout`, legacy `show_firmware: true` prepends `firmware` to Top, and `hide_quick_stats: true` moves all Top chips to Hidden. Once an explicit layout exists, those legacy flags no longer affect placement.

### Hub

```yaml
chip_layout:
  top:
    - hardware
    - firmware
  details:
    - frequency
    - bandwidth
    - spreading_factor
    - tx_power
    - ch1_voltage
    - rate_limiter
  hidden: []
```

## Node chip reference

The entity column lists the preferred MeshCore metric suffix, not a full entity ID. Discovery remains scoped to the selected node's device. A visible placement does not manufacture data: chips with no valid state are omitted.

### Device and network

| Chip ID | Display | Backing data | Unit or formatting | Default |
| --- | --- | --- | --- | --- |
| `firmware` | Firmware | Device registry `sw_version` | text | Hidden |
| `uptime` | Uptime | `uptime` | days formatted as days/hours | Top |
| `neighbor_count` | Neighbours heard | Device-scoped neighbour sensors | rolling 48-hour count | Top |
| `route` | Route | `out_path`, then `routing_path` | text | Details |
| `path_length` | Path length | `out_path_len`, then `path_length` | count | Details |

The neighbour chip is shown only when the integration exposes neighbour data and `show_neighbors` is not false. It opens the recent-neighbours dialog rather than an entity more-info dialog.

### Radio

| Chip ID | Display | Entity suffix | Unit or formatting | Default |
| --- | --- | --- | --- | --- |
| `spreading_factor` | Spreading factor | `spreading_factor` | `SF` prefix | Details |
| `frequency` | Frequency | `frequency` | MHz | Details |
| `bandwidth` | Bandwidth | `bandwidth` | kHz | Details |
| `tx_power` | TX power | `tx_power` | dBm | Details |

RSSI, SNR, and noise floor are core metric tiles rather than configurable chips.

### Network traffic

| Chip ID | Display | Entity suffix | Unit | Default |
| --- | --- | --- | --- | --- |
| `sent` | Sent | `nb_sent` | count | Top |
| `received` | Received | `nb_recv` | count | Top |
| `relayed` | Relayed | `relayed` | count | Details |
| `sent_direct` | Sent direct | `sent_direct` | count | Details |
| `sent_flood` | Sent flood | `sent_flood` | count | Details |
| `received_direct` | Received direct | `recv_direct` | count | Details |
| `received_flood` | Received flood | `recv_flood` | count | Details |

### Airtime and message rates

| Chip ID | Display | Preferred entity suffix | Unit | Default |
| --- | --- | --- | --- | --- |
| `tx_airtime` | TX airtime | `airtime_utilization` | % | Details |
| `rx_airtime` | RX airtime | `rx_airtime_utilization` | % | Details |
| `tx_airtime_total` | TX airtime total | `airtime` | minutes | Details |
| `rx_airtime_total` | RX airtime total | `rx_airtime` | minutes | Details |
| `tx_rate` | TX/min | `nb_sent_rate` | messages per minute | Details |
| `rx_rate` | RX/min | `nb_recv_rate` | messages per minute | Details |
| `sent_direct_rate` | Sent direct rate | `sent_direct_rate` | msg/min | Details |
| `sent_flood_rate` | Sent flood rate | `sent_flood_rate` | msg/min | Details |
| `received_direct_rate` | Received direct rate | `recv_direct_rate` | msg/min | Details |
| `received_flood_rate` | Received flood rate | `recv_flood_rate` | msg/min | Details |
| `direct_duplicates_rate` | Direct duplicates rate | `direct_dups_rate` | msg/min | Details |
| `flood_duplicates_rate` | Flood duplicates rate | `flood_dups_rate` | msg/min | Details |
| `receive_errors_rate` | Receive errors rate | `recv_errors_rate` | msg/min | Details |

Utilization and accumulated airtime are deliberately separate: `tx_airtime` and `rx_airtime` are percentages, while the `*_airtime_total` chips are accumulated minutes.

### Reliability

| Chip ID | Display | Entity suffix | Unit | Default |
| --- | --- | --- | --- | --- |
| `canceled` | Canceled | `canceled` | count | Details |
| `duplicate` | Duplicate | `duplicate` | count | Details |
| `direct_duplicates` | Direct duplicates | `direct_dups` | count | Details |
| `flood_duplicates` | Flood duplicates | `flood_dups` | count | Details |
| `queue_length` | Queue | `tx_queue_len` | count | Details |
| `queue_full_events` | Queue full events | `full_evts` | count | Details |
| `receive_errors` | Receive errors | `recv_errors` | count | Details |
| `request_successes` | Request successes | `request_successes` | requests | Details |
| `request_failures` | Request failures | `request_failures` | requests | Details |

### Telemetry

| Chip ID | Display | Entity suffix | Unit | Default |
| --- | --- | --- | --- | --- |
| `temperature` | Temperature | `temperature` | °C | Top |
| `humidity` | Humidity | `humidity` | % | Details |
| `illuminance` | Illuminance | `illuminance` | lx | Details |
| `pressure` | Pressure | `pressure` | hPa | Details |

The four telemetry readings can use the flat entity overrides documented in [Entity discovery and overrides](/configuration#entity-discovery-and-overrides).

## Hub chip reference

| Chip ID | Display | Backing data | Unit or formatting | Default |
| --- | --- | --- | --- | --- |
| `hardware` | Hardware | `hw_model` attribute on hub status or node-count entity | text | Top |
| `firmware` | Firmware | `firmware_version` attribute on hub status or node-count entity | text | Top |
| `frequency` | Frequency | `frequency` | MHz, three decimal places | Details |
| `bandwidth` | Bandwidth | `bandwidth` | kHz | Details |
| `spreading_factor` | Spreading factor | `spreading_factor` | `SF` prefix | Details |
| `tx_power` | TX power | `tx_power` | dBm | Details |
| `ch1_voltage` | Ch1 | `ch1_voltage` | V | Details |
| `rate_limiter` | Rate | `request_rate_limiter` | tokens | Details |

Hub battery, location, MQTT status, and node count are separate card primitives and are not chip-layout IDs.

## MeshCore HA 2.9 compatibility

Subscribed repeaters can expose the diagnostics defined by the official [MeshCore HA 2.9 sensors](https://github.com/meshcore-dev/meshcore-ha/blob/v2.9.0/custom_components/meshcore/sensor.py) and [sensor documentation](https://meshcore-dev.github.io/meshcore-ha/docs/ha/sensors/). The card prefers current v2.9 suffixes while retaining older aliases:

| Chip or reading | Preferred suffix | Compatibility aliases, in order |
| --- | --- | --- |
| `tx_rate` | `nb_sent_rate` | `tx_per_minute`, `tx_rate`, `messages_per_minute` |
| `rx_rate` | `nb_recv_rate` | `rx_per_minute`, `rx_rate` |
| `queue_length` | `tx_queue_len` | `queue_length` |
| `route` | `out_path` | `routing_path` |
| `path_length` | `out_path_len` | `path_length` |
| Repeater battery voltage | `bat` | `battery_voltage` |

The direct/flood counters, specialized rates, airtime totals, and poll reliability chips use their v2.9 suffixes shown above. Exact device-scoped matching prevents similarly named sensors such as `airtime` and `rx_airtime` from being confused.

Not every tracked client, sensor, or repeater exposes every metric. `unknown`, `unavailable`, empty, and invalid numeric states are treated as absent. This is expected behavior, not a reason to configure every entity manually.

Return to the [Main card guide](/cards/main), review all [configuration fields](/configuration), or see [Troubleshooting](/troubleshooting#metrics-or-chips-are-missing).
