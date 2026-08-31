# Troubleshooting

Start by confirming the requirements and installation steps in [Getting started](/getting-started). After updating the card, reload the frontend with a hard refresh so Home Assistant does not continue using an older JavaScript resource.

## The custom card is not found

Symptoms include **Custom element doesn't exist** or a missing card picker entry.

1. Confirm `mushroom-meshcore-card.js` is installed.
2. For a manual installation, confirm `/local/mushroom-meshcore-card.js` is registered under **Settings → Dashboards → Resources** as a **JavaScript module**.
3. Confirm YAML uses one of the coexistence-safe public types:
   - `custom:mushroom-meshcore-card`
   - `custom:mushroom-meshcore-channel-card`
   - `custom:mushroom-meshcore-mentions-card`
4. Reload Home Assistant's frontend and hard-refresh the browser. Clear the frontend cache only if the hard refresh does not update the resource.

Do not use the upstream `meshcore-*` element names for this fork. Installation details are in [Getting started](/getting-started).

## No hubs or nodes appear in the editor

The Main card discovers targets through Home Assistant's MeshCore device and entity registries.

- Confirm the MeshCore integration is installed, loaded, and has created devices and entities.
- Confirm the relevant registry entities are not disabled unexpectedly.
- Reload the dashboard after the integration finishes populating its registries.
- Select the target in the visual editor to capture its exact identifier.

Every card requires an explicit target. A grouped legacy configuration using `hubs`, `nodes`, or `nodes_order` is intentionally ignored and must be split into one card per device. See [Main-card configuration](/configuration#main-card).

## The selected target is not found

Node IDs are discovered device names; hub IDs are discovered public-key identifiers. They are not interchangeable, and the card never falls back to another device.

Re-select the target in the editor after a MeshCore device is renamed or recreated. If editing YAML, preserve the complete target shape:

```yaml
target:
  type: node
  id: Spring Farm
```

Channel entities must match `binary_sensor.meshcore_*_ch_<n>_messages`. Mentions targets must be existing `todo.*` entities. The [configuration reference](/configuration) lists each target contract.

## Metrics or chips are missing

Missing data is normally omitted by design. The Main card treats `unknown`, `unavailable`, empty, and invalid numeric states as absent, and different MeshCore devices expose different sensor sets.

1. Open **Developer Tools → States** and check whether the expected entity has a valid value.
2. Confirm the entity belongs to the selected MeshCore device in the entity registry.
3. Check the chip is in `chip_layout.top` or `chip_layout.details`, not `hidden`.
4. Remember that an explicit layout hides every supported chip omitted from all three arrays.
5. Use a flat entity override only when automatic, device-scoped discovery cannot resolve the intended battery, voltage, location, or environmental sensor.

RSSI, SNR, and noise floor are metric tiles, not chip IDs. `hide_metrics: true` hides them. Battery is also separate from chip layout. See [Chip layout and metrics](/chips) for every ID and MeshCore HA 2.9 alias.

## A node shows Offline or Unknown

When available, the enabled MeshCore `online` binary sensor is authoritative:

- `on` renders Online.
- `off` renders Offline.
- `unknown` remains Unknown, which commonly means the node has not yet been polled successfully during the current integration session.

Older integrations fall back to recent uptime, request-success, or status data. Offline and unknown nodes intentionally collapse to a short header rather than showing stale unavailable metrics. Check the integration and the target's connectivity entities before changing card configuration.

## The battery or location is wrong

The card uses device-scoped discovery first. Set `battery_entity`, `voltage_entity`, or the environmental overrides to an exact entity ID if more than one plausible sensor exists.

For a node location override, `location_entity` must expose valid, non-zero `latitude` and `longitude` attributes. A map link is hidden if either coordinate is missing or invalid. Hub location comes from the hub's own latitude and longitude sensors.

## MeshMapper opens the wrong map

MeshMapper needs both settings:

```yaml
map_provider: meshmapper
map_metro: smf
```

The metro is a subdomain and must contain only 1–20 letters, digits, or hyphens after trimming and lowercasing. Invalid or missing MeshMapper configuration safely falls back to LetsMesh Analyzer. See [Maps](/configuration#maps).

## The neighbour chip or dialog is empty

Neighbour data covers the rolling 48-hour window and is shown only when the integration exposes supported neighbour sensors.

- Confirm `show_neighbors` is not `false`.
- Confirm the selected target is a node; hubs do not use the neighbour chip.
- A zero count can be valid when no neighbour was provably heard in the last 48 hours.
- `max_neighbors` limits dialog rows only. It does not change the count on the chip.

## Content is clipped or the card is too tall

A numeric `grid_options.rows` puts the card in fixed-height mode. The Main card clips content outside that allocation; Channel and Mentions make their content area scrollable.

Increase `rows`, use `rows: auto`, reduce visible chip content, or collapse Details. Home Assistant advertises the card-specific defaults listed under [Grid options](/configuration#grid-options).

## Channel history is empty or unavailable

The Channel card reads Home Assistant's live Logbook stream, not only the current binary-sensor state.

- Confirm the selected entity exists and matches the MeshCore channel entity pattern.
- Confirm Logbook is enabled and the entity is being recorded rather than excluded from Recorder.
- Check `hours_to_show`; older messages are intentionally excluded.
- Check `max_messages`; only the newest rows up to that limit are retained.
- A history request or subscription failure can leave normal entity state available while message history is unavailable.

See the [Channel card guide](/cards/channel) for the full message and history behavior.

## Channel route details are missing

Route pills depend on native MeshCore messaging events received while at least one Channel-card instance is loaded. Logbook does not retain those native route fields, so old messages cannot be enriched retroactively.

- Confirm `hide_route_details` is not `true`.
- Use MeshCore HA 2.9 or later for the native routing fields.
- Home Assistant may reject arbitrary event subscriptions for non-administrator users. In that case Logbook messages still work, but route details remain hidden.
- Per-user frontend-storage failure degrades gracefully to live-only enrichment.
- A regional packet does not contain a reversible scope name. Add the expected scope under **MeshCore → Configure → Global Settings → Flood Scope Allowlist** if you want MeshCore HA to emit a displayable name.

Path tokens are truncated public-key hashes and contact names are best-effort local inferences, not authenticated routing identities. The [Channel card guide](/cards/channel) explains route caching, permissions, and security boundaries.

## Mentions are not appearing

Installing the frontend card does not import or run the automation blueprint.

1. Create a dedicated Local To-do list.
2. Import the blueprint and create an enabled automation from it.
3. Select the same To-do entity in the automation and the card.
4. Confirm incoming events use `message_type: channel` and contain a configured `@Name` or `@[Name]` tag.

Use the test event and targeted diagnostics in the [MeshCore Mentions blueprint guide](/mentions-blueprint). The [Mentions card guide](/cards/mentions) explains handled items, timestamps, and Earlier mentions.

## Header actions do nothing

Check that the configured action includes its required field: `navigation_path` for `navigate`, `url_path` for `url`, or a complete `domain.service` in `perform_action`/`service` for action calls. A default `more-info` action also needs the selected target to resolve a primary entity.

Header actions apply only to the Tile header. Entity-backed metrics and chips deliberately keep their own more-info behavior. See [Header actions](/configuration#header-actions).

## Theme or Card Mod changes do not apply

- Confirm the variable is placed on the custom card's `ha-card` or inherited through a supported `--mush-*`/Home Assistant theme variable.
- Prefer the scoped variables in [Theming and Card Mod](/theming) over internal class selectors.
- Check spelling and include the leading `--` in CSS.
- Hard-refresh after changing a theme or frontend resource.
- Remember that `icon_color` is intentionally suppressed for offline and unavailable states.

Mushroom and Card Mod are not required; removing either should leave a functional Home Assistant-themed card.

## Still stuck?

Open an issue in the [Mushroom MeshCore Card repository](https://github.com/2wenty2wo/mushroom-meshcore-card/issues) with:

- the card YAML with secrets removed;
- the exact card and MeshCore integration versions;
- the selected target entity states and relevant registry relationship;
- browser console errors;
- whether the behavior changes after a hard refresh;
- a screenshot when the problem is visual.

Do not post private keys, precise locations, private channel content, or other sensitive Home Assistant data.
