# MeshCore Mentions blueprint

The **MeshCore Mentions** automation blueprint listens for channel-message events from the MeshCore integration, detects a configured companion tag, writes a persistent item to a Local To-do list, and can optionally send the same mention to one or more Home Assistant notification entities. The Mentions card reads that To-do list and presents the items as a dated inbox.

## Requirements

- Home Assistant 2026.5.0 or later
- The [MeshCore integration](https://github.com/meshcore-dev/meshcore-ha), configured and emitting `meshcore_message` events
- A dedicated **Local To-do** list named **MeshCore Mentions** that the automation can write and the card can update
- Mushroom MeshCore Card installed through HACS or manually

The frontend installation and blueprint import are independent. HACS installs `mushroom-meshcore-card.js`; it does not create an automation, listen for events, or send notifications. Importing the blueprint does not install the dashboard card.

## Import and configure

[![Import the MeshCore Mentions blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2F2wenty2wo%2Fmushroom-meshcore-card%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmeshcore%2Fmention_notifications.yaml)

The permanent source is [`blueprints/automation/meshcore/mention_notifications.yaml`](https://github.com/2wenty2wo/mushroom-meshcore-card/blob/main/blueprints/automation/meshcore/mention_notifications.yaml). A Blueprint Exchange post is not required to import it.

1. In Home Assistant, create a new Local To-do list named **MeshCore Mentions** under **Settings → Devices & services → Add integration → Local To-do**. Keep it separate from personal tasks.
2. Use the import button above, review the blueprint, and select **Import blueprint**.
3. Create an automation from **MeshCore Mentions**.
4. Configure the inputs below, save the automation, and make sure it is enabled.
5. Add `custom:mushroom-meshcore-mentions-card` to a dashboard and select the same Local To-do entity used by the automation.

### Inputs

- **Companion names** (`companion_names`) is an ordered list of names that may be tagged. Matching is case-insensitive and recognizes both `@Name` and `@[Name]` anywhere in a channel message. Blank entries are ignored and the first configured match wins, so put longer or more specific names first when names overlap.
- **Local To-do entity** (`todo_entity`) is where mentions are stored. Select the dedicated **MeshCore Mentions** entity in both the blueprint and the Mentions card.
- **Notification entities** (`notification_targets`) is optional and may contain multiple `notify` entities. Leave it empty when only the card inbox is wanted.

The automation listens only to `meshcore_message` events whose `message_type` is `channel`. For a matched message, it first adds a To-do item, then sends optional notifications. A notification failure therefore does not prevent the card entry from being created.

## Data contract

Each matched event produces a summary in this exact form:

```text
sender on channel: message
```

The sender comes from `sender_name`, falling back to `Unknown` when it is absent. The channel comes from `channel`; if it is absent, the automation uses `channel <channel_idx>`. The Mentions card uses the summary structure to separate the username, channel, and message. The notification body uses the same summary, and its title is `📡 MeshCore tag: <matched companion>`.

The blueprint stores the received time as the item's complete description:

```text
meshcore_received_at: 2026-08-29T12:00:00+10:00
```

The event's timezone-aware ISO timestamp is used when valid; otherwise the automation records its current time. This fallback also covers timezone-less timestamps from older MeshCore integration versions. The card interprets a description as timestamp metadata only when the entire description is that marker with a valid ISO timestamp. Other descriptions remain ordinary visible descriptions.

Timestamped items are grouped by received date and sorted newest-first. Items without trustworthy received timestamps are displayed last under **Earlier mentions** rather than being assigned an invented date. Pending and handled items are grouped separately.

## Card configuration

```yaml
type: custom:mushroom-meshcore-mentions-card
entity: todo.meshcore_mentions
hide_completed: true
hide_timestamps: false
hide_date_headers: false
grid_options:
  columns: full
```

Dates and times are visible by default and follow Home Assistant's locale, time-zone, and clock settings. `hide_timestamps` hides the time on each row without changing its group or ordering. `hide_date_headers` hides date headings, including **Earlier mentions**. Disable `hide_completed` to show handled mentions and reopen them from the card.

## Test without waiting for a radio message

In **Settings → Tools → Events**, fire an event named `meshcore_message` with event data like this, replacing `YourName` with one of the configured companion names:

```yaml
message_type: channel
message: "Blueprint test for @YourName"
sender_name: Test Node
channel: Public
channel_idx: 0
timestamp: "2026-08-29T12:00:00+10:00"
```

Confirm that exactly one item is added to the configured Local To-do list, that it appears under the expected date in the Mentions card, and that each selected notification entity receives it. Also test `@[YourName]`, different letter casing, and a message with no configured tag. The unmatched message must not create an item.

## Troubleshooting

- **No item is created:** Confirm the automation is enabled, the event has `message_type: channel`, and the message contains a configured `@Name` or `@[Name]`. Check the automation trace for the actual event data and matching result.
- **The item exists but is not in the card:** Verify that the card's `entity` is exactly the same Local To-do entity selected in the blueprint, then reload the dashboard.
- **Duplicate items or notifications:** Check that only one enabled automation was created from this blueprint.
- **No notification arrives:** Notifications are optional. Confirm at least one available `notify` entity is selected and inspect the automation trace. To-do creation occurs first, so the card entry may still succeed.
- **An item appears under Earlier mentions:** Entries without a valid full-description `meshcore_received_at:` marker intentionally have no displayed received time.
- **A description is shown as text:** The card deliberately preserves descriptions that are not exactly the reserved timestamp marker. This avoids misreading user-created To-do content.
- **The sender or channel looks wrong:** Inspect the `sender_name`, `channel`, and `channel_idx` fields on the source `meshcore_message` event. The automation cannot recover identity data that the integration did not provide.

## Updating the blueprint

Blueprints imported from GitHub are not installed by HACS and should be refreshed separately after blueprint changes. Open **Settings → Automations & scenes → Blueprints**, re-import the source URL (or use the import button above), review the updated blueprint, and reload automations if Home Assistant prompts you. Existing automations retain their selected inputs because the blueprint path and input IDs are stable.
