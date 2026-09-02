# Getting started

Mushroom MeshCore Card adds five Home Assistant dashboard cards and one badge for the
[MeshCore integration](https://github.com/meshcore-dev/meshcore-ha):

- [Main card](/cards/main) for one hub or remote node
- [Channel card](/cards/channel) for one MeshCore channel conversation
- [Mentions card](/cards/mentions) for an automation-backed mention inbox
- [Releases card](/cards/releases) for explicitly configured software release sensors
- [Status card and badge](/cards/status) for the health of one hub and its managed child nodes

The cards and badge follow Mushroom and Home Assistant styling, but neither
Mushroom nor Card Mod is required. They use Home Assistant theme fallbacks and
can also be installed alongside the original `meshcore-card` because their
custom-element names are different.

## Requirements

- Home Assistant 2023.x or later
- Home Assistant 2024.8 or later when using the Status badge; the Status card
  remains available on earlier supported versions
- The [MeshCore integration](https://github.com/meshcore-dev/meshcore-ha),
  installed and configured
- Home Assistant 2026.5.0 or later only when using the bundled Mentions
  blueprint

## Install with HACS

1. Open **HACS → Frontend**.
2. Open the **⋮** menu and select **Custom repositories**.
3. Add `https://github.com/2wenty2wo/mushroom-meshcore-card` as a
   **Dashboard** repository.
4. Install **Mushroom MeshCore Card**.
5. Reload the browser.

[![Add Repository](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=2wenty2wo&repository=mushroom-meshcore-card&category=plugin)

HACS installs the frontend resource. It does not import or configure the
separate automation blueprint used by the Mentions card.

## Install manually

1. Download `mushroom-meshcore-card.js` from the latest
   [GitHub release](https://github.com/2wenty2wo/mushroom-meshcore-card/releases).
2. Copy it to `config/www/mushroom-meshcore-card.js`.
3. In **Settings → Dashboards → Resources**, add
   `/local/mushroom-meshcore-card.js` as a **JavaScript module**.
4. Reload the browser.

When replacing a manual installation, overwrite the existing file and perform
a hard refresh so the browser does not keep an older bundle cached. See
[Troubleshooting](/troubleshooting) if the cards do not appear in the picker.

## Add your first card

Add a new card in the Home Assistant dashboard editor and choose the relevant
Mushroom MeshCore card. Device, Channel, Mentions, and Status editors begin with their
required target; Releases begins with its explicit source list. Supporting
device entities are discovered automatically wherever possible.

### A remote node

Select the node in the visual editor, or use its discovered device name in
YAML:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: node
  id: Spring Farm
```

The card renders exactly that node. It does not silently substitute another
device if the target is missing or cannot be resolved. See the complete
[Main card guide](/cards/main).

### A hub

Hub targets use the discovered public-key identifier:

```yaml
type: custom:mushroom-meshcore-card
target:
  type: hub
  id: 55733c
```

The visual editor is the easiest way to obtain the correct identifier.

### A channel

Choose one discovered channel message entity:

```yaml
type: custom:mushroom-meshcore-channel-card
entity: binary_sensor.meshcore_edfaf6_ch_0_messages
```

The entity must match `binary_sensor.meshcore_*_ch_<n>_messages`. The card
loads that entity's Logbook stream; it does not combine channels. Continue with
the [Channel card guide](/cards/channel).

### A mentions inbox

The Mentions card reads a dedicated Local To-do list:

```yaml
type: custom:mushroom-meshcore-mentions-card
entity: todo.meshcore_mentions
```

Before the card can receive mentions, create the Local To-do list and an
automation from the bundled blueprint. Follow the
[Mentions card guide](/cards/mentions) and the
[blueprint setup guide](/mentions-blueprint).

### Software releases

The Releases card reads Home Assistant sensors whose states and attributes
contain release metadata:

```yaml
type: custom:mushroom-meshcore-releases-card
sources:
  - entity: sensor.meshcore_latest_release
    name: MeshCore
```

The frontend card does not contact GitHub or Codeberg. Follow the
[Releases card guide](/cards/releases) for the complete REST sensor setup and
the seven-source MeshCore ecosystem example.

### Network status

Choose a hub to summarize its connection and the managed nodes associated with it:

```yaml
type: custom:mushroom-meshcore-status-card
target:
  type: hub
  id: 55733c
```

The companion badge uses the same hub target and health model:

```yaml
type: custom:mushroom-meshcore-status-badge
target:
  type: hub
  id: 55733c
```

The card explains problems and exposes monitored-node and diagnostic disclosures.
The badge provides a compact summary and opens the same problem details by default.
Continue with the [Status card and badge guide](/cards/status).

## Next steps

- Review every field in the [configuration reference](/configuration).
- Arrange main-card content with the [chip reference](/chips).
- Monitor ecosystem software with the [Releases card](/cards/releases).
- Keep network health visible with the [Status card and badge](/cards/status).
- Match the cards to your dashboard using [theming and Card Mod](/theming).
- Use [Troubleshooting](/troubleshooting) for installation, discovery, and
  entity-state problems.
