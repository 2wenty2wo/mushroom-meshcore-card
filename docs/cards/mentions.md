# Mentions card

The Mentions card presents a dedicated Home Assistant Local To-do list as a
dated MeshCore mention inbox. The bundled automation blueprint detects tags in
channel-message events and writes the records that the card displays.

![Mushroom MeshCore Mentions Card](../../screenshots/mentions-card.png)

## Requirements

- Home Assistant 2026.5.0 or later for the bundled blueprint
- MeshCore HA configured and emitting `meshcore_message` events
- A dedicated Local To-do list
- Mushroom MeshCore Card installed through HACS or manually

Installing the dashboard resource and importing the blueprint are independent
steps. HACS does not create the background automation, and importing the
blueprint does not install the frontend card.

## Set up the inbox

1. In **Settings → Devices & services → Add integration**, add **Local To-do**
   and create a list named **MeshCore Mentions**.
2. Import the **MeshCore Mentions** blueprint and create an automation from it.
3. Configure the companion names to recognize, select the new Local To-do
   entity, and optionally select notification entities.
4. Add the Mentions card and select that same Local To-do entity.

[![Import the MeshCore Mentions blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2F2wenty2wo%2Fmushroom-meshcore-card%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmeshcore%2Fmention_notifications.yaml)

Keep the list dedicated to mention records. The card displays every item in the
selected list, including user-created content that does not match the
blueprint's structured format.

For blueprint inputs, matching rules, event testing, notification behavior,
and update instructions, follow the complete
[MeshCore Mentions blueprint guide](/mentions-blueprint).

## Complete example

```yaml
type: custom:mushroom-meshcore-mentions-card
entity: todo.meshcore_mentions
name: MeshCore Mentions
icon: mdi:at
icon_color: orange
tap_action:
  action: more-info
hold_action:
  action: none
double_tap_action:
  action: none
hide_completed: true
hide_timestamps: false
hide_date_headers: false
hide_links: false
grid_options:
  columns: full
  rows: 6
```

The `entity` must be an existing `todo.*` entity. The visual editor lists all
available To-do entities; choose the Local To-do entity used by the blueprint.
It exposes Appearance, Interactions, and Mentions settings after one is
selected. Missing, invalid, unresolved, `unknown`, and `unavailable` targets
each produce an explanatory local state instead of selecting a substitute list.

See the [configuration reference](/configuration) for action formats, color
values, defaults, and grid options.

## How items are displayed

The blueprint writes each mention summary in this form:

```text
sender on channel: message
```

The card separates that summary into sender, channel, and message fields. It
groups timestamped items by received date and sorts them newest-first using
Home Assistant's locale, time zone, and clock format. Items without trustworthy
blueprint timestamp metadata remain visible under **Earlier mentions** rather
than being assigned an invented date. Non-matching summaries are displayed
unchanged.

Dates and timestamps are visible by default:

- `hide_timestamps: true` hides each row's time without changing grouping or
  ordering.
- `hide_date_headers: true` hides date headings, including **Earlier
  mentions**.
- `hide_completed` defaults to `true`. Set it to `false` to show separate
  pending and handled sections.

`http://` and `https://` URLs in the mention message become links that open in
a new tab. Only those two schemes are ever linked, the visible text is left
unchanged, and mention text originates from unauthenticated mesh traffic — so
treat a link as you would one from a stranger. Set `hide_links: true` to render
URLs as plain text instead. See the
[channel card](/cards/channel#links) for the full description.

## Handle and reopen mentions

Select a row's checkbox to mark a pending mention completed. When handled
mentions are visible, select its checkbox again to reopen it. The selected
To-do entity must support item updates; otherwise the controls are disabled.
An update failure is reported in the card and does not silently change the
stored item.

The primary header defaults to more-info for the selected To-do entity. Hold
and double-tap default to no action, and all three can use standard Home
Assistant action configurations.

## Subscription and data limitations

The card subscribes to the selected To-do entity; it does not listen for radio
messages itself. If the To-do subscription is unavailable, the card reports
that state and cannot populate the inbox until Home Assistant reconnects.

The card does not perform mention detection or create received-time metadata;
it only parses the exact summary and description contracts produced by the
blueprint. Existing or manually created To-do items remain visible, but the
card does not infer a timestamp or sender when their content lacks those
contracts. Descriptions that are not the reserved timestamp marker are
preserved as ordinary visible text.

Start with [Getting started](/getting-started). For setup failures, use the
[blueprint troubleshooting steps](/mentions-blueprint#troubleshooting) and the
general [Troubleshooting guide](/troubleshooting).
