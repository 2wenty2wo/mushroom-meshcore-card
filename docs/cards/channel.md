# Channel card

The channel card turns one MeshCore channel's Home Assistant Logbook stream
into a newest-first, scrollable conversation below a Tile-style header.

![Mushroom MeshCore Channel Card](../../screenshots/channel-card.png)

## Required target

Every card requires one existing channel message entity with this shape:

```text
binary_sensor.meshcore_*_ch_<n>_messages
```

Choose it in the visual editor or configure it directly:

```yaml
type: custom:mushroom-meshcore-channel-card
entity: binary_sensor.meshcore_edfaf6_ch_0_messages
```

The card does not select a channel automatically and does not merge several
channels. A missing, invalid, or unresolved entity produces a local
configuration prompt.

## Complete example

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
hide_route_details: false
hide_links: false
hours_to_show: 24
max_messages: 200
grid_options:
  columns: full
  rows: 8
```

The history defaults to the most recent 24 hours and at most 200 messages.
Dates, timestamps, and route details are visible by default and can be hidden
independently. `hours_to_show` and `max_messages` must be finite numbers of at
least 1; invalid values use their defaults. See the
[configuration reference](/configuration) for every field and action.

## Message formatting

The channel name is derived from the selected entity and its friendly name.
Each Logbook message is then formatted without changing its content:

- One leading MeshCore channel prefix such as `<Public>` is removed.
- Text before the first colon is emphasized as the sender. The `://` of a URL
  does not count, so a message that opens with a link keeps its whole text.
- Later colons and line breaks remain part of the message body.
- Messages without a sender colon are displayed as body-only entries.
- Empty messages and bare channel prefixes are omitted.
- `http://` and `https://` URLs become links that open in a new tab.

Dates and times follow the active Home Assistant locale, time zone, and clock
settings. The header action targets the selected channel entity; individual
route pills have their own behavior.

### Links

Only URLs written with an explicit `http://` or `https://` scheme are made
clickable. Text such as `www.example.com` stays plain, and any other scheme —
`javascript:`, `data:`, `file:` and the rest — is never turned into a link. The
visible text is unchanged, so you can always read the address you are about to
open. Links open in a new tab with `rel="noopener noreferrer"`.

Channel messages are unauthenticated: anyone within radio range chooses the
text, and therefore the address behind a link. Treat a mesh link exactly as you
would an unsolicited link from a stranger. Set `hide_links: true` to render
URLs as plain text instead.

## Live route details

With MeshCore HA 2.9 or later, messages observed while a channel-card instance
is active can be enriched from the integration's native messaging events. When
the integration supplies the data, compact pills can show:

- Hop count
- The selected path hash, including automatically detected one-, two-, or
  three-byte path width
- Regional or named flood scope

Selecting the **Path** pill opens every unique live route reported for that
message. The dialog resolves path tokens against repeater contacts belonging to
the selected channel's hub on a best-effort basis. Unknown and ambiguous tokens
remain explicit.

Incoming packets do not contain a reversible flood-scope name. To display a
name such as `au`, add it under **MeshCore → Configure → Global Settings →
Flood Scope Allowlist**. MeshCore HA can then emit `flood_scope: "#au"`, which
the card shows as `au`. When a message is known to be region-scoped but no
single exact name is available, it remains labelled **Regional**.

### Security and interpretation

Route details are reception hints, not authenticated routing data:

- Channel messages are unverified.
- Path tokens are truncated public-key hashes, not reversible identities.
- Repeater names are locally inferred and may be unknown or ambiguous.
- Hop, path, width, and scope fields are shown only when supplied and validated;
  the card does not invent missing metadata.

Do not use the displayed route as proof that a particular person or repeater
sent or forwarded a message.

## Persistence, permissions, and limitations

Home Assistant Logbook does not retain MeshCore's native route fields. The card
therefore stores matched routing metadata in Home Assistant's per-user frontend
storage. The shared, bounded cache allows the same account to retain pills and
popup routes across dashboard reloads, browser restarts, and other signed-in
devices. `hours_to_show` and `max_messages` control the Logbook rows visible in
this card; they do not turn the shared cache into a permanent message archive.

Important limitations:

- A route cannot be backfilled for a message received while no channel-card
  instance was active.
- Frontend-storage failures degrade to live-only enrichment; Logbook history
  remains available.
- Home Assistant may reject arbitrary `subscribe_events` subscriptions for a
  non-administrator account. In that case, route details stay hidden while the
  Logbook conversation continues to work.
- Route and contact data are scoped to the current Home Assistant user and the
  selected channel target.

Set `hide_route_details: true` when the extra routing context should not be
shown. The card continues to receive routing events, and the setting does not
clear records already held in per-user frontend storage.

## Dashboard sizing

The channel card requests full width, eight rows, and a minimum of six columns
by default in a Sections dashboard. Setting a numeric `grid_options.rows` makes
the scrollable history fill that allocated height. Without a numeric row value,
the history uses its normal fixed viewport.

Start with [Getting started](/getting-started), or consult
[Troubleshooting](/troubleshooting) if Logbook history or route details do not
load.
