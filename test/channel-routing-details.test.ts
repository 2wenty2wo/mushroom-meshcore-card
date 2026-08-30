import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeshcoreChannelCard,
  splitRoutePath,
} from "../src/channel-card.js";
import type { HomeAssistant, MeshcoreChannelCardConfig } from "../src/types.js";
import {
  CHANNEL_ENTITY,
  HUB_DEVICE_ID,
  createChannelHass,
  defineOnce,
  device,
  registryEntry,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);

const CONFIG_ENTRY_ID = "meshcore-hub-entry";
const NOW = Math.floor(new Date("2026-08-25T12:00:00Z").getTime() / 1000);

type SubscriptionCallback = (message: unknown) => void;

interface Subscription {
  callback: SubscriptionCallback;
  params: Record<string, unknown>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface MockConnection {
  connection: NonNullable<HomeAssistant["connection"]>;
  subscribeMessage: ReturnType<typeof vi.fn>;
  subscriptions: Subscription[];
  readyListeners: Array<() => void>;
}

interface ChannelPathDialogRoute {
  hopCount: number;
  pathSegments: readonly string[];
  hashSizeBytes?: 1 | 2 | 3;
  direct?: boolean;
}

interface ShowDialogDetail {
  dialogTag: string;
  dialogImport: () => Promise<unknown>;
  dialogParams: {
    title: string;
    routes: readonly ChannelPathDialogRoute[];
    contacts: readonly { publicKey: string; name: string }[];
    contactsPromise?: Promise<readonly { publicKey: string; name: string }[]>;
    returnFocus?: HTMLElement;
    resolveReturnFocus?: () => HTMLElement | undefined;
  };
}

function subscriptionName(params: Record<string, unknown>): string {
  return params["type"] === "logbook/event_stream"
    ? "logbook"
    : String(params["event_type"] ?? "");
}

function createConnection(rejected = new Set<string>()): MockConnection {
  const subscriptions: Subscription[] = [];
  const readyListeners: Array<() => void> = [];
  const subscribeMessage = vi.fn(
    (callback: SubscriptionCallback, params: Record<string, unknown>) => {
      const name = subscriptionName(params);
      if (rejected.has(name)) return Promise.reject(new Error(`${name} unavailable`));
      const unsubscribe = vi.fn();
      subscriptions.push({ callback, params, unsubscribe });
      return Promise.resolve(unsubscribe);
    }
  );
  const connection = {
    subscribeMessage,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "ready") readyListeners.push(listener);
    },
    removeEventListener: vi.fn(),
  } as unknown as NonNullable<HomeAssistant["connection"]>;
  return { connection, subscribeMessage, subscriptions, readyListeners };
}

function targetHass(mock: MockConnection): HomeAssistant {
  const hass = createChannelHass();
  Object.assign(hass.devices[HUB_DEVICE_ID]!, {
    config_entries: [CONFIG_ENTRY_ID],
    primary_config_entry: CONFIG_ENTRY_ID,
  });
  hass.connection = mock.connection;
  return hass;
}

async function createCard(
  config: MeshcoreChannelCardConfig = { entity: CHANNEL_ENTITY },
  mock = createConnection()
): Promise<{
  card: MeshcoreChannelCard;
  mock: MockConnection;
  hass: HomeAssistant;
}> {
  const card = document.createElement(
    "mushroom-meshcore-channel-card"
  ) as MeshcoreChannelCard;
  card.setConfig(config);
  const hass = targetHass(mock);
  card.hass = hass;
  document.body.appendChild(card);
  await vi.advanceTimersByTimeAsync(0);
  return { card, mock, hass };
}

function subscription(mock: MockConnection, name: string): Subscription {
  let result: Subscription | undefined;
  for (let index = mock.subscriptions.length - 1; index >= 0; index -= 1) {
    const candidate = mock.subscriptions[index]!;
    if (subscriptionName(candidate.params) === name) {
      result = candidate;
      break;
    }
  }
  expect(result, `missing ${name} subscription`).toBeDefined();
  return result!;
}

function fireLogbook(
  mock: MockConnection,
  entries: Array<{
    when: number;
    message: string;
    context_id?: string;
    entity_id?: string;
  }>
): void {
  subscription(mock, "logbook").callback({
    events: entries.map((entry) => ({
      name: "Public",
      entity_id: CHANNEL_ENTITY,
      ...entry,
    })),
  });
}

function fireEvent(
  mock: MockConnection,
  eventType: "meshcore_message" | "meshcore_delivery_update" | "meshcore_message_sent",
  data: Record<string, unknown>,
  contextId?: string,
  timeFired = NOW
): void {
  subscription(mock, eventType).callback({
    event_type: eventType,
    data,
    origin: "LOCAL",
    time_fired: new Date(timeFired * 1000).toISOString(),
    context: contextId
      ? { id: contextId, parent_id: null, user_id: null }
      : { id: "", parent_id: null, user_id: null },
  });
}

function channelMessage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    entity_id: CHANNEL_ENTITY,
    message: "hello",
    sender_name: "Alice",
    channel: "Public",
    channel_idx: 0,
    timestamp: NOW,
    message_type: "channel",
    ...overrides,
  };
}

function reception(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    path_len: 2,
    path: "A1B2",
    path_hash_size: 1,
    region_scope: false,
    flood_scope: null,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300);
}

function rowFor(card: MeshcoreChannelCard, body: string): HTMLElement {
  const row = Array.from(
    card.shadowRoot!.querySelectorAll<HTMLElement>(".message-row")
  ).find((candidate) =>
    candidate.querySelector(".message-body")?.textContent?.includes(body)
  );
  expect(row, `missing message row for ${body}`).toBeDefined();
  return row!;
}

function pill(row: HTMLElement, icon: string): HTMLElement | null {
  return row.querySelector<HTMLElement>(`ha-icon[icon="${icon}"]`)?.parentElement ?? null;
}

async function openPathsDialog(
  card: MeshcoreChannelCard,
  row: HTMLElement
): Promise<ShowDialogDetail> {
  let detail: ShowDialogDetail | undefined;
  card.addEventListener(
    "show-dialog",
    ((event: CustomEvent<ShowDialogDetail>) => {
      detail = event.detail;
    }) as EventListener,
    { once: true }
  );
  const trigger = row.querySelector<HTMLButtonElement>(
    "button.message-route-detail.path[data-channel-paths]"
  );
  expect(trigger).not.toBeNull();
  trigger!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(detail).toBeDefined();
  return detail!;
}

function addContactState(
  hass: HomeAssistant,
  entityId: string,
  deviceId: string,
  attributes: Record<string, unknown>,
  includeState = true
): void {
  const registry = registryEntry(deviceId);
  registry.entity_id = entityId;
  hass.entities[entityId] = registry;
  if (!includeState) return;
  const entityState = state("on", attributes);
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
}

async function renderRoutedMessage(
  card: MeshcoreChannelCard,
  mock: MockConnection,
  body = "contact route"
): Promise<HTMLElement> {
  fireEvent(
    mock,
    "meshcore_message",
    channelMessage({
      message: body,
      rx_log_data: [
        reception({ path_len: 2, path: "A1B2", path_hash_size: 1 }),
      ],
    }),
    `context-${body}`
  );
  fireLogbook(mock, [
    {
      when: NOW,
      context_id: `context-${body}`,
      message: `Alice: ${body}`,
    },
  ]);
  await settle();
  return rowFor(card, body);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW * 1000));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("route path normalization", () => {
  it.each([
    [undefined, 1, 1],
    ["", 1, 1],
    ["AABB", 1, "1"],
    ["AABB", 1, 1.5],
    ["AABB", 1, 0],
    ["AABB", 0, undefined],
    ["AABB", 3, undefined],
    ["AABB", undefined, undefined],
  ] as const)(
    "rejects value=%s, pathLength=%s, hashSize=%s",
    (value, pathLength, hashSize) => {
      expect(splitRoutePath(value, pathLength, hashSize)).toBeUndefined();
    }
  );

  it("infers a one-hop two-byte path without an explicit hash size", () => {
    expect(splitRoutePath("aabb", 1, undefined)).toEqual(["AABB"]);
  });
});

describe("channel routing subscriptions", () => {
  it("subscribes to Logbook plus the three native MeshCore event streams", async () => {
    const { mock } = await createCard();

    expect(
      mock.subscriptions.map(({ params }) => subscriptionName(params)).sort()
    ).toEqual([
      "logbook",
      "meshcore_delivery_update",
      "meshcore_message",
      "meshcore_message_sent",
    ]);
    for (const name of [
      "meshcore_message",
      "meshcore_delivery_update",
      "meshcore_message_sent",
    ]) {
      expect(subscription(mock, name).params).toMatchObject({
        type: "subscribe_events",
        event_type: name,
      });
    }
  });

  it("keeps Logbook usable when every optional native subscription fails", async () => {
    const rejected = new Set([
      "meshcore_message",
      "meshcore_delivery_update",
      "meshcore_message_sent",
    ]);
    const { card, mock } = await createCard(
      { entity: CHANNEL_ENTITY },
      createConnection(rejected)
    );

    fireLogbook(mock, [
      { when: NOW, context_id: "plain", message: "Alice: still visible" },
    ]);
    await settle();

    expect(card.shadowRoot!.textContent).toContain("still visible");
    expect(card.shadowRoot!.textContent).not.toContain("history is unavailable");
    expect(card.shadowRoot!.querySelector(".message-route-details")).toBeNull();
  });

  it("keeps Logbook usable when an optional subscription throws synchronously", async () => {
    const mock = createConnection();
    const original = mock.connection.subscribeMessage.bind(mock.connection);
    mock.connection.subscribeMessage = ((
      callback: SubscriptionCallback,
      params: Record<string, unknown>,
      options?: { resubscribe?: boolean }
    ) => {
      if (params["event_type"] === "meshcore_delivery_update") {
        throw new Error("event stream unavailable");
      }
      return original(callback, params, options);
    }) as NonNullable<HomeAssistant["connection"]>["subscribeMessage"];
    const { card } = await createCard({ entity: CHANNEL_ENTITY }, mock);

    fireLogbook(mock, [
      { when: NOW, message: "Alice: Logbook survives" },
    ]);
    await settle();

    expect(card.shadowRoot!.textContent).toContain("Logbook survives");
    expect(card.shadowRoot!.textContent).not.toContain("history is unavailable");
  });

  it("reconnects all streams and cleans up all live subscriptions", async () => {
    const { card, mock } = await createCard();
    expect(mock.readyListeners).toHaveLength(1);

    mock.readyListeners[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(8);

    card.remove();
    for (const current of mock.subscriptions.slice(4)) {
      expect(current.unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores malformed native envelopes without affecting Logbook", async () => {
    const { card, mock } = await createCard();
    const native = subscription(mock, "meshcore_message").callback;
    native(null);
    native([]);
    native({ event_type: "meshcore_message", data: null });
    native({ event_type: "meshcore_message", data: [] });
    native({
      event_type: "meshcore_message",
      data: { message_type: "direct" },
    });
    fireLogbook(mock, [{ when: NOW, message: "Alice: unaffected" }]);
    await settle();

    expect(card.shadowRoot!.textContent).toContain("unaffected");
    expect(card.shadowRoot!.querySelector(".message-route-details")).toBeNull();
  });

  it("ignores a native callback from a superseded subscription generation", async () => {
    const { card, mock } = await createCard();
    const stale = subscription(mock, "meshcore_message").callback;
    card.setConfig({ entity: CHANNEL_ENTITY, hours_to_show: 48 });
    await vi.advanceTimersByTimeAsync(0);

    stale({
      event_type: "meshcore_message",
      data: channelMessage({ message: "stale callback", hop_count: 6 }),
      time_fired: new Date(NOW * 1000).toISOString(),
      context: { id: "stale-callback" },
    });
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "stale-callback",
        message: "Alice: stale callback",
      },
    ]);
    await settle();

    expect(rowFor(card, "stale callback").querySelector(".message-route-details")).toBeNull();
  });
});

describe("channel routing correlation", () => {
  it("enriches by context whether the native event or Logbook row arrives first", async () => {
    const { card, mock } = await createCard();

    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "event first",
        rx_log_data: [reception({ path_len: 1, path: "AA" })],
      }),
      "context-event-first"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "context-event-first",
        message: "Alice: event first",
      },
      {
        when: NOW - 1,
        context_id: "context-logbook-first",
        message: "Alice: logbook first",
      },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "logbook first",
        timestamp: NOW - 1,
        rx_log_data: [reception({ path_len: 3, path: "AABBCC" })],
      }),
      "context-logbook-first"
    );
    await settle();

    expect(pill(rowFor(card, "event first"), "mdi:transit-connection-variant")?.textContent).toContain("1");
    expect(pill(rowFor(card, "logbook first"), "mdi:transit-connection-variant")?.textContent).toContain("3");
  });

  it("accepts Home Assistant's wrapped event payload shape", async () => {
    const { card, mock } = await createCard();
    subscription(mock, "meshcore_message").callback({
      event: {
        event_type: "meshcore_message",
        data: channelMessage({ message: "wrapped", hop_count: 2 }),
        time_fired: new Date(NOW * 1000).toISOString(),
        context: { id: "wrapped" },
      },
    });
    fireLogbook(mock, [
      { when: NOW, context_id: "wrapped", message: "Alice: wrapped" },
    ]);
    await settle();

    expect(
      pill(rowFor(card, "wrapped"), "mdi:transit-connection-variant")?.textContent
    ).toContain("2");
  });

  it("ignores foreign entities and non-channel message events", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        entity_id: "binary_sensor.meshcore_other_ch_0_messages",
        rx_log_data: [reception()],
      }),
      "foreign"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message_type: "direct",
        rx_log_data: [reception()],
      }),
      "direct"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "wrong channel index",
        channel_idx: 1,
        rx_log_data: [reception()],
      }),
      "wrong-index"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "invalid direction",
        outgoing: "yes",
        rx_log_data: [reception()],
      }),
      "invalid-direction"
    );
    subscription(mock, "meshcore_message").callback({
      event_type: "meshcore_delivery_update",
      data: channelMessage({
        message: "wrong reported type",
        rx_log_data: [reception()],
      }),
      time_fired: new Date(NOW * 1000).toISOString(),
      context: { id: "wrong-reported-type" },
    });
    fireLogbook(mock, [
      { when: NOW, context_id: "foreign", message: "Alice: foreign" },
      { when: NOW - 1, context_id: "direct", message: "Alice: direct" },
      {
        when: NOW - 2,
        context_id: "wrong-index",
        message: "Alice: wrong channel index",
      },
      {
        when: NOW - 3,
        context_id: "wrong-reported-type",
        message: "Alice: wrong reported type",
      },
      {
        when: NOW - 4,
        context_id: "invalid-direction",
        message: "Alice: invalid direction",
      },
    ]);
    await settle();

    expect(rowFor(card, "foreign").querySelector(".message-route-details")).toBeNull();
    expect(rowFor(card, "direct").querySelector(".message-route-details")).toBeNull();
    expect(rowFor(card, "wrong channel index").querySelector(".message-route-details")).toBeNull();
    expect(rowFor(card, "wrong reported type").querySelector(".message-route-details")).toBeNull();
    expect(rowFor(card, "invalid direction").querySelector(".message-route-details")).toBeNull();
  });

  it("rejects invalid correlation inputs without borrowing nearby metadata", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "incoming send id",
        send_id: "not-valid-for-incoming",
        hop_count: 2,
      }),
      "incoming-send-id"
    );
    fireEvent(
      mock,
      "meshcore_delivery_update",
      channelMessage({
        message: "no correlation key",
        timestamp: undefined,
        hop_count: 3,
      })
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "different native body", hop_count: 4 })
    );
    subscription(mock, "meshcore_message").callback({
      event_type: "meshcore_message",
      data: channelMessage({
        message: "timeless",
        timestamp: undefined,
        hop_count: 5,
      }),
      time_fired: "invalid",
      context: { id: "timeless-native" },
    });
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "incoming-send-id",
        message: "Alice: incoming send id",
      },
      { when: NOW - 1, message: "Alice: no correlation key" },
      { when: NOW - 2, message: "Alice: different logbook body" },
      { when: NOW - 3, message: "Alice: timeless" },
    ]);
    await settle();

    for (const body of [
      "incoming send id",
      "no correlation key",
      "different logbook body",
      "timeless",
    ]) {
      expect(rowFor(card, body).querySelector(".message-route-details")).toBeNull();
    }
  });

  it("matches a Logbook row without entity_id and ignores its replay", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "implicit entity", hop_count: 2 }),
      "implicit-entity"
    );
    const entry = {
      when: NOW,
      context_id: "implicit-entity",
      entity_id: undefined,
      message: "Alice: implicit entity",
    };
    fireLogbook(mock, [entry]);
    fireLogbook(mock, [entry]);
    await settle();

    expect(
      pill(rowFor(card, "implicit entity"), "mdi:transit-connection-variant")
        ?.textContent
    ).toContain("2");
    expect(card.shadowRoot!.querySelectorAll(".message-row")).toHaveLength(1);
  });

  it("retains an existing message event time when a duplicate lacks one", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "missing event time", hop_count: 1 }),
      "missing-event-time"
    );
    subscription(mock, "meshcore_message").callback({
      event_type: "meshcore_message",
      data: channelMessage({ message: "missing event time", hop_count: 1 }),
      time_fired: "invalid",
      context: { id: "missing-event-time" },
    });
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "missing-event-time",
        message: "Alice: missing event time",
      },
    ]);
    await settle();

    expect(
      pill(rowFor(card, "missing event time"), "mdi:transit-connection-variant")
    ).not.toBeNull();
  });

  it("uses send_id to carry an outgoing scope onto the exact Logbook row", async () => {
    const { card, mock } = await createCard();
    fireEvent(mock, "meshcore_message_sent", {
      device: CONFIG_ENTRY_ID,
      message: "outbound",
      message_type: "channel",
      receiver: "Public",
      timestamp: NOW,
      channel_idx: 0,
      send_id: "send-1",
      scope: "#au-nsw-syd",
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "outbound",
        sender_name: "Me",
        outgoing: true,
        send_id: "send-1",
        hop_count: 0,
        rx_log_data: [
          reception({ flood_scope: "#rx-fallback", region_scope: true }),
        ],
      }),
      "outbound-context"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "outbound-context",
        message: "Me: outbound",
      },
    ]);
    await settle();

    const row = rowFor(card, "outbound");
    expect(pill(row, "mdi:web")?.textContent).toContain("au-nsw-syd");
    expect(pill(row, "mdi:web")?.textContent).not.toContain("#au-nsw-syd");
    expect(pill(row, "mdi:web")?.textContent).not.toContain("rx-fallback");
    // A selected reception's path_len is authoritative over top-level hop_count.
    expect(pill(row, "mdi:transit-connection-variant")?.textContent).toContain("2");
  });

  it("accepts entry_id and send_timestamp with only a primary config entry", async () => {
    const { card, mock, hass } = await createCard();
    const deviceId = hass.entities[CHANNEL_ENTITY]!.device_id!;
    hass.devices[deviceId]!.config_entries = undefined;
    hass.devices[deviceId]!.primary_config_entry = CONFIG_ENTRY_ID;
    fireEvent(mock, "meshcore_message_sent", {
      entry_id: CONFIG_ENTRY_ID,
      channel_idx: 0,
      message: "primary entry",
      message_type: "channel",
      send_timestamp: NOW,
      send_id: "primary-entry",
      scope: "#primary",
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "primary entry",
        sender_name: "Me",
        outgoing: true,
        send_id: "primary-entry",
        hop_count: 0,
      }),
      "primary-entry"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "primary-entry", message: "Me: primary entry" },
    ]);
    await settle();

    expect(pill(rowFor(card, "primary entry"), "mdi:web")?.textContent).toContain("primary");
  });

  it("isolates sent scopes to the selected entity's config entry on a shared device", async () => {
    const { card, mock, hass } = await createCard();
    hass.entities[CHANNEL_ENTITY]!.config_entry_id = "selected-channel-entry";
    hass.devices[HUB_DEVICE_ID]!.primary_config_entry = "other-entry";
    hass.devices[HUB_DEVICE_ID]!.config_entries = [
      "other-entry",
      "selected-channel-entry",
    ];
    fireEvent(mock, "meshcore_message_sent", {
      device: "other-entry",
      channel_idx: 0,
      message: "shared device scope",
      message_type: "channel",
      timestamp: NOW,
      send_id: "shared-device-send",
      scope: "#wrong",
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "shared device scope",
        sender_name: "Me",
        outgoing: true,
        send_id: "shared-device-send",
        hop_count: 0,
      }),
      "shared-device-scope"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "shared-device-scope",
        message: "Me: shared device scope",
      },
    ]);
    await settle();

    expect(pill(rowFor(card, "shared device scope"), "mdi:web")).toBeNull();

    fireEvent(mock, "meshcore_message_sent", {
      device: "selected-channel-entry",
      channel_idx: 0,
      message: "shared device scope",
      message_type: "channel",
      timestamp: NOW,
      send_id: "shared-device-send",
      scope: "#right",
    });
    await settle();

    expect(
      pill(rowFor(card, "shared device scope"), "mdi:web")?.textContent
    ).toContain("right");
  });

  it("promotes an unfiltered pending scope only after an exact-target message", async () => {
    const { card, mock, hass } = await createCard();
    hass.entities[CHANNEL_ENTITY]!.device_id = null;
    fireEvent(mock, "meshcore_message_sent", {
      device: "unresolvable-entry",
      channel_idx: 0,
      message: "confirmed later",
      message_type: "channel",
      timestamp: NOW,
      send_id: "confirmed-later",
      scope: "#confirmed",
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "confirmed later",
        sender_name: "Me",
        outgoing: true,
        send_id: "confirmed-later",
        hop_count: 0,
      }),
      "confirmed-later"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "confirmed-later", message: "Me: confirmed later" },
    ]);
    await settle();

    expect(pill(rowFor(card, "confirmed later"), "mdi:web")?.textContent).toContain("confirmed");
  });

  it("adds an outgoing scope when message_sent arrives after the matched message", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "late scope",
        sender_name: "Me",
        outgoing: true,
        send_id: "late-send",
        hop_count: 0,
      }),
      "late-scope"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "late-scope", message: "Me: late scope" },
    ]);
    await settle();
    expect(pill(rowFor(card, "late scope"), "mdi:web")).toBeNull();

    fireEvent(mock, "meshcore_message_sent", {
      device: CONFIG_ENTRY_ID,
      channel_idx: 0,
      message_type: "channel",
      timestamp: NOW,
      send_id: "late-send",
      scope: "#au",
    });
    await settle();

    expect(pill(rowFor(card, "late scope"), "mdi:web")?.textContent).toContain("au");
  });

  it("does not merge a pending sent scope into a divergent outgoing message", async () => {
    const { card, mock } = await createCard();
    fireEvent(mock, "meshcore_message_sent", {
      device: CONFIG_ENTRY_ID,
      channel_idx: 0,
      message: "expected body",
      message_type: "channel",
      timestamp: NOW,
      send_id: "divergent-send",
      scope: "#private",
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "different body",
        sender_name: "Me",
        outgoing: true,
        send_id: "divergent-send",
        hop_count: 0,
      }),
      "divergent"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "divergent", message: "Me: different body" },
    ]);
    await settle();

    expect(pill(rowFor(card, "different body"), "mdi:web")).toBeNull();
  });

  it("rejects a second native message that reuses send_id for another body", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "original send",
        outgoing: true,
        send_id: "reused",
        hop_count: 1,
      }),
      "original-send"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "collision",
        outgoing: true,
        send_id: "reused",
        hop_count: 6,
      }),
      "collision"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "original-send", message: "Alice: original send" },
      { when: NOW - 1, context_id: "collision", message: "Alice: collision" },
    ]);
    await settle();

    expect(
      pill(rowFor(card, "original send"), "mdi:transit-connection-variant")
        ?.textContent
    ).toContain("1");
    expect(rowFor(card, "collision").querySelector(".message-route-details")).toBeNull();
  });

  it("rejects outgoing scopes from another hub or channel", async () => {
    const { card, mock } = await createCard();
    for (const [sendId, device, channelIdx] of [
      ["wrong-device", "another-entry", 0],
      ["wrong-channel", CONFIG_ENTRY_ID, 2],
    ] as const) {
      fireEvent(mock, "meshcore_message_sent", {
        device,
        channel_idx: channelIdx,
        message: sendId,
        message_type: "channel",
        timestamp: NOW,
        send_id: sendId,
        scope: "#must-not-leak",
      });
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: sendId,
          sender_name: "Me",
          outgoing: true,
          send_id: sendId,
          hop_count: 0,
        }),
        sendId
      );
    }
    fireLogbook(mock, [
      { when: NOW, context_id: "wrong-device", message: "Me: wrong-device" },
      { when: NOW - 1, context_id: "wrong-channel", message: "Me: wrong-channel" },
    ]);
    await settle();

    expect(pill(rowFor(card, "wrong-device"), "mdi:web")).toBeNull();
    expect(pill(rowFor(card, "wrong-channel"), "mdi:web")).toBeNull();
  });

  it("bounds pending outgoing scopes before a matching message arrives", async () => {
    const { card, mock } = await createCard({
      entity: CHANNEL_ENTITY,
      max_messages: 1,
    });
    for (let index = 0; index < 22; index += 1) {
      fireEvent(mock, "meshcore_message_sent", {
        device: CONFIG_ENTRY_ID,
        channel_idx: 0,
        message_type: "channel",
        timestamp: NOW,
        send_id: `bounded-scope-${index}`,
        scope: "#au",
      });
    }
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "evicted scope",
        sender_name: "Me",
        outgoing: true,
        send_id: "bounded-scope-0",
        hop_count: 0,
      }),
      "evicted-scope"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "evicted-scope", message: "Me: evicted scope" },
    ]);
    await settle();

    expect(pill(rowFor(card, "evicted scope"), "mdi:web")).toBeNull();
  });

  it("falls back to a one-to-one nearest timestamp match for repeated text", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "repeat",
        timestamp: NOW - 8,
        rx_log_data: [reception({ path_len: 1, path: "AA" })],
      }),
      undefined,
      NOW - 8
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "repeat",
        timestamp: NOW - 1,
        rx_log_data: [reception({ path_len: 2, path: "AABB" })],
      }),
      undefined,
      NOW - 1
    );
    fireLogbook(mock, [
      { when: NOW - 7, message: "Alice: repeat" },
      { when: NOW, message: "Alice: repeat" },
    ]);
    await settle();

    const values = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        '.message-route-details ha-icon[icon="mdi:transit-connection-variant"]'
      )
    ).map((icon) => icon.parentElement!.textContent!.trim());
    expect(values).toHaveLength(2);
    expect(values.join(" ")).toContain("1");
    expect(values.join(" ")).toContain("2");
  });

  it("matches by the native event time when the integration timestamp is absent", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW, message: "Alice: event-time fallback" },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "event-time fallback",
        timestamp: undefined,
        hop_count: 4,
      })
    );
    await settle();

    expect(
      pill(rowFor(card, "event-time fallback"), "mdi:transit-connection-variant")
        ?.textContent
    ).toContain("4");
  });

  it("normalizes millisecond, numeric-string, ISO, and invalid timestamps safely", async () => {
    const { card, mock } = await createCard();
    const cases: Array<[string, unknown]> = [
      ["millisecond number", NOW * 1000],
      ["millisecond string", String(NOW * 1000)],
      ["ISO timestamp", new Date(NOW * 1000).toISOString()],
      ["invalid timestamp", "definitely-not-a-date"],
    ];
    cases.forEach(([body, timestamp], index) => {
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({ message: body, timestamp, hop_count: index }),
        `timestamp-${index}`
      );
    });
    fireLogbook(
      mock,
      cases.map(([body], index) => ({
        when: NOW,
        context_id: `timestamp-${index}`,
        message: `Alice: ${body}`,
      }))
    );
    await settle();

    for (const [body] of cases) {
      expect(
        pill(rowFor(card, body), "mdi:transit-connection-variant")
      ).not.toBeNull();
    }
  });

  it("does not associate metadata outside both event and integration time windows", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "too late",
        timestamp: NOW - 20,
        hop_count: 2,
      }),
      undefined,
      NOW - 30
    );
    fireLogbook(mock, [{ when: NOW, message: "Alice: too late" }]);
    await settle();

    expect(rowFor(card, "too late").querySelector(".message-route-details")).toBeNull();
  });

  it("rejects native channel metadata without the required sender", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ sender_name: undefined, message: "announcement", hop_count: 1 }),
      "announcement"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "announcement",
        message: "<Public> announcement",
      },
    ]);
    await settle();

    expect(rowFor(card, "announcement").querySelector(".message-route-details")).toBeNull();
  });

  it("tries the next-nearest unoccupied row for identical repeated messages", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW - 2, message: "Alice: duplicated" },
      { when: NOW - 1, message: "Alice: duplicated" },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "duplicated",
        timestamp: NOW - 2,
        rx_log_data: [reception({ path_len: 1, path: "AA" })],
      })
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "duplicated",
        timestamp: NOW - 1,
        rx_log_data: [reception({ path_len: 2, path: "BBCC" })],
      })
    );
    await settle();

    const pathValues = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        '.message-route-details ha-icon[icon="mdi:routes"]'
      )
    ).map((icon) => icon.parentElement!.textContent!.trim());
    expect(pathValues).toHaveLength(2);
    expect(pathValues).toEqual(expect.arrayContaining(["AA", "BB,CC"]));
  });

  it("moves a provisional match from identical old history to the new streamed row", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW - 5, message: "Alice: same payload" },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "same payload", hop_count: 4 })
    );
    fireLogbook(mock, [
      { when: NOW, message: "Alice: same payload" },
    ]);
    await settle();

    const rows = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".message-row")
    );
    expect(rows).toHaveLength(2);
    expect(
      pill(rows[0]!, "mdi:transit-connection-variant")?.textContent
    ).toContain("4");
    expect(rows[1]!.querySelector(".message-route-details")).toBeNull();
  });

  it("does not attach a delivery_update-only record until meshcore_message arrives", async () => {
    const { card, mock } = await createCard();
    const data = channelMessage({
      message: "progressive gate",
      outgoing: true,
      send_id: "progressive-gate",
      rx_log_data: [reception({ path_len: 2, path: "AABB" })],
    });
    fireEvent(mock, "meshcore_delivery_update", data);
    fireLogbook(mock, [
      { when: NOW, message: "Alice: progressive gate" },
    ]);
    await settle();
    expect(rowFor(card, "progressive gate").querySelector(".message-route-details")).toBeNull();

    fireEvent(mock, "meshcore_message", data);
    await settle();
    expect(
      pill(rowFor(card, "progressive gate"), "mdi:routes")?.textContent
    ).toContain("AA,BB");
  });

  it("matches an incoming delivery update by its parent message timestamp", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW - 5, message: "Alice: incoming update" },
      { when: NOW + 20, message: "Alice: incoming update" },
    ]);
    fireEvent(
      mock,
      "meshcore_delivery_update",
      channelMessage({
        message: "incoming update",
        timestamp: NOW - 5,
        rx_log_data: [reception({ path_len: 3, path: "AABBCC" })],
      }),
      undefined,
      NOW + 20
    );
    await settle();

    const rows = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".message-row")
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".message-route-details")).toBeNull();
    expect(pill(rows[1]!, "mdi:routes")?.textContent).toContain("AA,BB,CC");
  });

  it("rerenders a matched message when a later delivery update adds its route", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "late delivery", hop_count: 0 }),
      "late-delivery"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "late-delivery", message: "Alice: late delivery" },
    ]);
    await settle();
    expect(pill(rowFor(card, "late delivery"), "mdi:routes")).toBeNull();

    fireEvent(
      mock,
      "meshcore_delivery_update",
      channelMessage({
        message: "late delivery",
        rx_log_data: [reception({ path_len: 2, path: "CCDD" })],
      })
    );
    await settle();

    expect(pill(rowFor(card, "late delivery"), "mdi:routes")?.textContent).toContain("CC,DD");
  });

  it("lets an exact context replace an earlier fallback association", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW, context_id: "authoritative", message: "Alice: replace me" },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "replace me", hop_count: 1 })
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "replace me",
        timestamp: NOW + 1,
        hop_count: 5,
      }),
      "authoritative",
      NOW + 1
    );
    await settle();

    expect(
      pill(rowFor(card, "replace me"), "mdi:transit-connection-variant")
        ?.textContent
    ).toContain("5");
  });

  it("moves a fallback-matched record when its contextual Logbook row arrives", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW - 1, message: "Alice: repeated route" },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "repeated route",
        timestamp: NOW - 1,
        hop_count: 3,
      }),
      "later-context",
      NOW - 1
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "later-context",
        message: "Alice: repeated route",
      },
    ]);
    await settle();

    const rows = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".message-row")
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".message-route-details")).not.toBeNull();
    expect(rows[1]!.querySelector(".message-route-details")).toBeNull();
  });

  it("leaves history-only rows plain", async () => {
    const { card, mock } = await createCard();
    fireLogbook(mock, [
      { when: NOW - 60, context_id: "history-only", message: "Alice: archived" },
    ]);
    await settle();

    expect(rowFor(card, "archived").querySelector(".message-route-details")).toBeNull();
  });

  it("expires unmatched routing records and pending outgoing scopes", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "expired route", hop_count: 4 }),
      "expired-route"
    );
    fireEvent(mock, "meshcore_message_sent", {
      device: CONFIG_ENTRY_ID,
      channel_idx: 0,
      message: "expired scope",
      message_type: "channel",
      timestamp: NOW,
      send_id: "expired-scope",
      scope: "#old",
    });
    await vi.advanceTimersByTimeAsync(61_000);

    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "expired-route",
        message: "Alice: expired route",
      },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "expired scope",
        sender_name: "Me",
        outgoing: true,
        send_id: "expired-scope",
        hop_count: 0,
      }),
      "expired-scope-context"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "expired-scope-context",
        message: "Me: expired scope",
      },
    ]);
    await settle();

    expect(rowFor(card, "expired route").querySelector(".message-route-details")).toBeNull();
    expect(pill(rowFor(card, "expired scope"), "mdi:web")).toBeNull();
  });

  it("bounds unmatched metadata and discards metadata for limited-out rows", async () => {
    const { card, mock } = await createCard({
      entity: CHANNEL_ENTITY,
      max_messages: 1,
    });
    for (let index = 0; index < 22; index += 1) {
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: `pending-${index}`,
          timestamp: NOW - index,
          hop_count: index % 4,
        }),
        `pending-${index}`,
        NOW - index
      );
    }

    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "old retained", timestamp: NOW - 2, hop_count: 1 }),
      "old-retained",
      NOW - 2
    );
    fireLogbook(mock, [
      {
        when: NOW - 2,
        context_id: "old-retained",
        message: "Alice: old retained",
      },
    ]);
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({ message: "new retained", hop_count: 2 }),
      "new-retained"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "new-retained",
        message: "Alice: new retained",
      },
    ]);
    await settle();

    expect(card.shadowRoot!.textContent).toContain("new retained");
    expect(card.shadowRoot!.textContent).not.toContain("old retained");
    expect(pill(rowFor(card, "new retained"), "mdi:transit-connection-variant")?.textContent).toContain("2");
  });
});

describe("channel routing normalization and presentation", () => {
  it("resolves focus to the current Path control after a live rerender", async () => {
    const { card, mock } = await createCard();
    const row = await renderRoutedMessage(card, mock, "focus route");
    const original = row.querySelector<HTMLElement>("[data-channel-paths]")!;
    const { dialogParams } = await openPathsDialog(card, row);

    expect(dialogParams.returnFocus).toBe(original);
    (card as unknown as { _render(): void })._render();
    const replacement = rowFor(card, "focus route")
      .querySelector<HTMLElement>("[data-channel-paths]")!;

    expect(original.isConnected).toBe(false);
    expect(replacement).not.toBe(original);
    expect(dialogParams.resolveReturnFocus?.()).toBe(replacement);
  });

  it("ignores invalid scopes and malformed reception records", async () => {
    const { card, mock } = await createCard();
    const invalidScopes: Array<[string, unknown]> = [
      ["hash scope", "#"],
      ["blank scope", "   "],
      ["long scope", "x".repeat(257)],
      ["numeric scope", 42],
    ];
    invalidScopes.forEach(([body, floodScope], index) => {
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: body,
          timestamp: NOW - index,
          hop_count: 0,
          rx_log_data: [
            reception({ flood_scope: floodScope, region_scope: false }),
          ],
        }),
        `invalid-scope-${index}`
      );
    });
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "malformed receptions",
        timestamp: NOW - 5,
        hop_count: 5,
        rx_log_data: [null, [], {}, "not-an-object"],
      }),
      "malformed-receptions"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "bounded receptions",
        timestamp: NOW - 6,
        hop_count: 1,
        rx_log_data: [
          ...Array.from({ length: 64 }, () => ({})),
          reception({ path_len: 1, path: "FF" }),
        ],
      }),
      "bounded-receptions"
    );
    fireLogbook(mock, [
      ...invalidScopes.map(([body], index) => ({
        when: NOW - index,
        context_id: `invalid-scope-${index}`,
        message: `Alice: ${body}`,
      })),
      {
        when: NOW - 5,
        context_id: "malformed-receptions",
        message: "Alice: malformed receptions",
      },
      {
        when: NOW - 6,
        context_id: "bounded-receptions",
        message: "Alice: bounded receptions",
      },
    ]);
    await settle();

    for (const [body] of invalidScopes) {
      expect(pill(rowFor(card, body), "mdi:web")).toBeNull();
    }
    const malformed = rowFor(card, "malformed receptions");
    expect(pill(malformed, "mdi:transit-connection-variant")?.textContent).toContain("5");
    expect(pill(malformed, "mdi:routes")).toBeNull();
    const bounded = rowFor(card, "bounded receptions");
    expect(pill(bounded, "mdi:transit-connection-variant")?.textContent).toContain("1");
    expect(pill(bounded, "mdi:routes")).toBeNull();
  });

  it("replaces cumulative route snapshots, dedupes them, and preserves a selected route only while present", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "progressive",
        rx_log_data: [
          reception({ path_len: 2, path: "A1B2" }),
          reception({ path_len: 2, path: "A1B2" }),
          reception({ path_len: 2, path: "C3D4" }),
        ],
      }),
      "progressive"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "progressive", message: "Alice: progressive" },
    ]);
    await settle();

    let row = rowFor(card, "progressive");
    expect(pill(row, "mdi:transit-connection-variant")?.textContent).toContain("2");
    expect(pill(row, "mdi:routes")?.textContent).toContain("A1,B2");
    let dialog = await openPathsDialog(card, row);
    expect(dialog.dialogParams.routes).toEqual([
      expect.objectContaining({
        hopCount: 2,
        pathSegments: ["A1", "B2"],
        hashSizeBytes: 1,
        direct: false,
      }),
      expect.objectContaining({
        hopCount: 2,
        pathSegments: ["C3", "D4"],
        hashSizeBytes: 1,
        direct: false,
      }),
    ]);

    fireEvent(
      mock,
      "meshcore_delivery_update",
      channelMessage({
        message: "progressive",
        progressive: true,
        rx_log_data: [
          reception({ path_len: 2, path: "C3D4" }),
          reception({ path_len: 2, path: "A1B2" }),
          reception({ path_len: 1, path: "EF" }),
          reception({ path_len: 2, path: "C3D4" }),
        ],
      })
    );
    await settle();

    row = rowFor(card, "progressive");
    expect(pill(row, "mdi:routes")?.textContent).toContain("A1,B2");
    dialog = await openPathsDialog(card, row);
    expect(dialog.dialogParams.routes.map((route) => route.pathSegments)).toEqual([
      ["C3", "D4"],
      ["A1", "B2"],
      ["EF"],
    ]);

    fireEvent(
      mock,
      "meshcore_delivery_update",
      channelMessage({
        message: "progressive",
        progressive: true,
        rx_log_data: [
          reception({ path_len: 2, path: "C3D4" }),
          reception({ path_len: 1, path: "EF" }),
          reception({ path_len: 2, path: "C3D4" }),
        ],
      })
    );
    await settle();

    row = rowFor(card, "progressive");
    expect(pill(row, "mdi:routes")?.textContent).toContain("C3,D4");
    expect(pill(row, "mdi:routes")?.textContent).not.toContain("A1,B2");
    dialog = await openPathsDialog(card, row);
    expect(dialog.dialogParams.routes.map((route) => route.pathSegments)).toEqual([
      ["C3", "D4"],
      ["EF"],
    ]);
  });

  it("renders a selected direct route as a path button and opens all current routes", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "direct and relayed",
        rx_log_data: [
          reception({
            path_len: 0,
            path: "",
            path_hash_size: 2,
          }),
          reception({
            path_len: 2,
            path: "A1B2C3D4",
            path_hash_size: 2,
          }),
        ],
      }),
      "direct-and-relayed"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "direct-and-relayed",
        message: "Alice: direct and relayed",
      },
    ]);
    await settle();

    const row = rowFor(card, "direct and relayed");
    expect(pill(row, "mdi:transit-connection-variant")?.textContent).toContain("0");
    const path = row.querySelector<HTMLButtonElement>(
      "button.message-route-detail.path[data-channel-paths]"
    )!;
    expect(path.textContent).toContain("Direct");
    expect(path.getAttribute("aria-haspopup")).toBe("dialog");
    expect(row.querySelector(".message-route-detail.bytes")).toBeNull();

    const dialog = await openPathsDialog(card, row);
    expect(dialog.dialogTag).toBe("mushroom-meshcore-channel-paths-dialog");
    expect(dialog.dialogImport).toEqual(expect.any(Function));
    expect(dialog.dialogParams.title).toContain("(2)");
    expect(dialog.dialogParams.routes).toEqual([
      expect.objectContaining({
        hopCount: 0,
        pathSegments: [],
        direct: true,
      }),
      expect.objectContaining({
        hopCount: 2,
        pathSegments: ["A1B2", "C3D4"],
        hashSizeBytes: 2,
        direct: false,
      }),
    ]);
  });

  it("normalizes one-, two-, and three-byte path hashes plus safe inference", async () => {
    const { card, mock } = await createCard();
    const cases = [
      ["one-byte", 1, "A1B2", "A1,B2", "1 byte"],
      ["two-byte", 2, "A1B2C3D4", "A1B2,C3D4", "2 bytes"],
      ["three-byte", 3, "A1B2C3D4E5F6", "A1B2C3,D4E5F6", "3 bytes"],
      ["inferred-one", undefined, "A1B2", "A1,B2", "1 byte"],
      ["inferred-two", undefined, "A1B2C3D4", "A1B2,C3D4", "2 bytes"],
      [
        "inferred-three",
        undefined,
        "A1B2C3D4E5F6",
        "A1B2C3,D4E5F6",
        "3 bytes",
      ],
    ] as const;
    for (const [index, [body, size, path]] of cases.entries()) {
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: body,
          timestamp: NOW - index,
          rx_log_data: [
            reception({ path_len: 2, path, path_hash_size: size }),
          ],
        }),
        `path-${index}`
      );
    }
    fireLogbook(
      mock,
      cases.map(([body], index) => ({
        when: NOW - index,
        context_id: `path-${index}`,
        message: `Alice: ${body}`,
      }))
    );
    await settle();

    for (const [body, , , expected, expectedWidth] of cases) {
      const row = rowFor(card, body);
      const path = pill(row, "mdi:routes")!;
      const width = row.querySelector<HTMLElement>(".message-route-detail.bytes")!;
      expect(path.textContent).toContain(expected);
      expect(width.textContent).toContain(expectedWidth);
      expect(
        path.compareDocumentPosition(width) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("renders an explicit hash path even when path_len is absent", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "path without hops",
        rx_log_data: [
          {
            path: "AABB",
            path_hash_size: 1,
            region_scope: false,
          },
        ],
      }),
      "path-without-hops"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "path-without-hops",
        message: "Alice: path without hops",
      },
    ]);
    await settle();

    const row = rowFor(card, "path without hops");
    expect(pill(row, "mdi:routes")?.textContent).toContain("AA,BB");
    expect(pill(row, "mdi:transit-connection-variant")).toBeNull();
  });

  it("omits malformed and ambiguous path values without losing a valid hop count", async () => {
    const { card, mock } = await createCard();
    const bad = [
      reception({ path_len: 2, path: "GGHH", path_hash_size: 1 }),
      reception({ path_len: 3, path: "AABB", path_hash_size: 1 }),
      reception({ path_len: 2, path: "AABB", path_hash_size: 4 }),
    ];
    bad.forEach((rx, index) =>
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: `bad-${index}`,
          timestamp: NOW - index,
          rx_log_data: [rx],
        }),
        `bad-${index}`
      )
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "mixed routes",
        timestamp: NOW - bad.length,
        rx_log_data: [
          bad[0],
          reception({ path_len: 2, path: "A1B2C3D4", path_hash_size: 2 }),
          null,
          bad[2],
        ],
      }),
      "mixed-routes"
    );
    fireLogbook(
      mock,
      [
        ...bad.map((_, index) => ({
          when: NOW - index,
          context_id: `bad-${index}`,
          message: `Alice: bad-${index}`,
        })),
        {
          when: NOW - bad.length,
          context_id: "mixed-routes",
          message: "Alice: mixed routes",
        },
      ]
    );
    await settle();

    for (let index = 0; index < bad.length; index += 1) {
      const row = rowFor(card, `bad-${index}`);
      expect(pill(row, "mdi:routes")).toBeNull();
      expect(row.querySelector("[data-channel-paths]")).toBeNull();
      expect(row.querySelector(".message-route-detail.bytes")).toBeNull();
      expect(pill(row, "mdi:transit-connection-variant")).not.toBeNull();
    }
    const mixed = rowFor(card, "mixed routes");
    expect(pill(mixed, "mdi:routes")?.textContent).toContain("A1B2,C3D4");
    expect((await openPathsDialog(card, mixed)).dialogParams.routes).toEqual([
      expect.objectContaining({
        pathSegments: ["A1B2", "C3D4"],
        hashSizeBytes: 2,
      }),
    ]);
  });

  it("rejects route values beyond MeshCore's bounded hop and path sizes", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "too many hops",
        timestamp: NOW,
        hop_count: 64,
      }),
      "too-many-hops"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "oversized path",
        timestamp: NOW - 1,
        rx_log_data: [
          reception({
            path_len: 22,
            path: "AA".repeat(66),
            path_hash_size: 3,
          }),
        ],
      }),
      "oversized-path"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "too many tokens",
        timestamp: String(NOW - 2),
        rx_log_data: [
          {
            path: "AA".repeat(64),
            path_hash_size: 1,
            flood_scope: "#au",
            region_scope: true,
          },
        ],
      }),
      "too-many-tokens"
    );
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "invalid rx hops",
        timestamp: NOW - 3,
        rx_log_data: [
          {
            path_len: 64,
            path: "AA",
            path_hash_size: 1,
            flood_scope: "#au",
            region_scope: true,
          },
        ],
      }),
      "invalid-rx-hops"
    );
    fireLogbook(mock, [
      {
        when: NOW,
        context_id: "too-many-hops",
        message: "Alice: too many hops",
      },
      {
        when: NOW - 1,
        context_id: "oversized-path",
        message: "Alice: oversized path",
      },
      {
        when: NOW - 2,
        context_id: "too-many-tokens",
        message: "Alice: too many tokens",
      },
      {
        when: NOW - 3,
        context_id: "invalid-rx-hops",
        message: "Alice: invalid rx hops",
      },
    ]);
    await settle();

    expect(
      rowFor(card, "too many hops").querySelector(".message-route-details")
    ).toBeNull();
    expect(pill(rowFor(card, "oversized path"), "mdi:routes")).toBeNull();
    expect(pill(rowFor(card, "too many tokens"), "mdi:routes")).toBeNull();
    expect(pill(rowFor(card, "invalid rx hops"), "mdi:routes")).toBeNull();
    expect(pill(rowFor(card, "invalid rx hops"), "mdi:web")?.textContent).toContain("au");
  });

  it("elides long paths visually while preserving the full path in attributes", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "long path",
        rx_log_data: [
          reception({ path_len: 6, path: "A1B2C3D4E5F6", path_hash_size: 1 }),
        ],
      }),
      "long-path"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "long-path", message: "Alice: long path" },
    ]);
    await settle();

    const path = pill(rowFor(card, "long path"), "mdi:routes")!;
    expect(path.textContent).toContain("A1,B2,…,E5,F6");
    expect(path.getAttribute("title")).toContain("A1,B2,C3,D4,E5,F6");
    expect(path.getAttribute("aria-label")).toContain("A1,B2,C3,D4,E5,F6");
  });

  it("uses a unique named scope across all receptions and explains generic or conflicting regions", async () => {
    const { card, mock } = await createCard();
    const cases = [
      ["named", [reception({ flood_scope: "#au", region_scope: true })]],
      [
        "named later",
        [
          reception({ path: "A1B2", flood_scope: null, region_scope: true }),
          reception({ path: "C3D4", flood_scope: "#au", region_scope: true }),
        ],
      ],
      ["regional", [{ flood_scope: null, region_scope: true }]],
      [
        "conflicting",
        [
          reception({ path: "A1B2", flood_scope: "#au", region_scope: true }),
          reception({ path: "C3D4", flood_scope: "#nz", region_scope: true }),
        ],
      ],
      ["unscoped", [reception({ flood_scope: null, region_scope: false })]],
    ] as const;
    cases.forEach(([body, routes], index) =>
      fireEvent(
        mock,
        "meshcore_message",
        channelMessage({
          message: body,
          timestamp: NOW - index,
          rx_log_data: routes,
        }),
        `scope-${body}`
      )
    );
    fireLogbook(
      mock,
      cases.map(([body], index) => ({
        when: NOW - index,
        context_id: `scope-${body}`,
        message: `Alice: ${body}`,
      }))
    );
    await settle();

    expect(pill(rowFor(card, "named"), "mdi:web")?.textContent).toContain("au");
    expect(pill(rowFor(card, "named"), "mdi:web")?.textContent).not.toContain("#au");
    expect(pill(rowFor(card, "named later"), "mdi:web")?.textContent).toContain("au");
    for (const body of ["regional", "conflicting"]) {
      const scope = pill(rowFor(card, body), "mdi:web")!;
      expect(scope.textContent).toContain("Regional");
      expect(scope.getAttribute("title")).toContain("Flood Scope Allowlist");
      expect(scope.getAttribute("aria-label")).toContain("Flood Scope Allowlist");
    }
    expect(pill(rowFor(card, "unscoped"), "mdi:web")).toBeNull();
  });

  it("keeps the timestamp beside the sender and renders route details after the body", async () => {
    const { card, mock } = await createCard();
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        rx_log_data: [
          reception({
            path_len: 2,
            path: "A1B2C3D4",
            path_hash_size: 2,
            flood_scope: "#au",
            region_scope: true,
          }),
        ],
      }),
      "layout"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "layout", message: "Alice: hello" },
    ]);
    await settle();

    const row = rowFor(card, "hello");
    const meta = row.querySelector(".message-meta")!;
    const body = row.querySelector(".message-body")!;
    const details = row.querySelector(".message-route-details")!;
    expect(meta.querySelector(".message-sender")?.textContent).toBe("Alice");
    expect(meta.querySelector(".message-time")).not.toBeNull();
    expect(Array.from(meta.children).map((child) => child.className)).toEqual([
      "message-sender",
      "message-time",
    ]);
    expect(meta.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(details.children).map((child) => child.classList[1])).toEqual([
      "hops",
      "path",
      "bytes",
      "scope",
    ]);
  });

  it("hides route details independently from timestamps", async () => {
    const hidden = await createCard({
      entity: CHANNEL_ENTITY,
      hide_route_details: true,
    });
    fireEvent(
      hidden.mock,
      "meshcore_message",
      channelMessage({
        message: "hidden route",
        rx_log_data: [
          reception({ path_len: 2, path: "A1B2C3D4", path_hash_size: 2 }),
        ],
      }),
      "hidden"
    );
    fireLogbook(hidden.mock, [
      { when: NOW, context_id: "hidden", message: "Alice: hidden route" },
    ]);

    const noTime = await createCard({
      entity: CHANNEL_ENTITY,
      hide_timestamps: true,
    });
    fireEvent(
      noTime.mock,
      "meshcore_message",
      channelMessage({
        message: "visible route",
        rx_log_data: [
          reception({ path_len: 2, path: "A1B2C3D4", path_hash_size: 2 }),
        ],
      }),
      "no-time"
    );
    fireLogbook(noTime.mock, [
      { when: NOW, context_id: "no-time", message: "Alice: visible route" },
    ]);
    await settle();

    expect(rowFor(hidden.card, "hidden route").querySelector(".message-time")).not.toBeNull();
    expect(rowFor(hidden.card, "hidden route").querySelector(".message-route-details")).toBeNull();
    expect(rowFor(hidden.card, "hidden route").querySelector("[data-channel-paths]")).toBeNull();
    expect(rowFor(noTime.card, "visible route").querySelector(".message-time")).toBeNull();
    expect(rowFor(noTime.card, "visible route").querySelector(".message-route-details")).not.toBeNull();
    expect(rowFor(noTime.card, "visible route").querySelector("[data-channel-paths]")).not.toBeNull();
  });

  it("escapes hostile and bidirectional scope values and rejects a hostile path", async () => {
    const { card, mock } = await createCard();
    const hostileScope = `#au\u061C\u200E\u200F\u202E\"><img src=x onerror=alert(1)>`;
    fireEvent(
      mock,
      "meshcore_message",
      channelMessage({
        message: "hostile metadata",
        rx_log_data: [
          reception({
            flood_scope: hostileScope,
            region_scope: true,
            path: `AA\"><img src=x onerror=alert(1)>`,
          }),
        ],
      }),
      "hostile"
    );
    fireLogbook(mock, [
      { when: NOW, context_id: "hostile", message: "Alice: hostile metadata" },
    ]);
    await settle();

    const row = rowFor(card, "hostile metadata");
    expect(row.querySelector("img, script, svg, iframe")).toBeNull();
    expect(pill(row, "mdi:web")?.textContent).toContain(
      `au \"><img src=x onerror=alert(1)>`
    );
    for (const control of ["\u061C", "\u200E", "\u200F", "\u202E"]) {
      expect(pill(row, "mdi:web")?.textContent).not.toContain(control);
      expect(pill(row, "mdi:web")?.getAttribute("title")).not.toContain(control);
    }
    expect(pill(row, "mdi:routes")).toBeNull();
  });
});

describe("channel route contact resolution", () => {
  it("ignores a stale or unknown path-dialog trigger", async () => {
    const { card } = await createCard();
    const shown = vi.fn();
    card.addEventListener("show-dialog", shown);
    const staleTrigger = document.createElement("button");
    staleTrigger.dataset["channelPaths"] = "missing";
    card.shadowRoot!.appendChild(staleTrigger);

    staleTrigger.click();

    expect(shown).not.toHaveBeenCalled();
  });

  it("uses only state-backed repeater contacts attached to the selected hub", async () => {
    const { card, mock, hass } = await createCard();
    hass.devices["foreign-hub"] = device("foreign-hub", { name: "Foreign" });
    addContactState(hass, "binary_sensor.meshcore_contact_a1", HUB_DEVICE_ID, {
      public_key: "a10000112233",
      adv_name: "Hill Repeater",
      type: 2,
    });
    addContactState(hass, "binary_sensor.meshcore_contact_a1_duplicate", HUB_DEVICE_ID, {
      public_key: "A10000112233",
      adv_name: "Duplicate should be ignored",
      type: "Repeater",
    });
    addContactState(hass, "binary_sensor.meshcore_contact_b2_legacy", HUB_DEVICE_ID, {
      adv_id: "b2",
      adv_name: "Legacy Ridge",
      contact_type: "repeater",
    });
    addContactState(hass, "binary_sensor.meshcore_contact_d4_one", HUB_DEVICE_ID, {
      adv_id: "d4",
      adv_name: "Prefix collision one",
      contact_type: "repeater",
    });
    addContactState(hass, "binary_sensor.meshcore_contact_d4_two", HUB_DEVICE_ID, {
      adv_id: "d4",
      adv_name: "Prefix collision two",
      contact_type: "repeater",
    });
    addContactState(hass, "binary_sensor.meshcore_contact_client", HUB_DEVICE_ID, {
      public_key: "C30000112233",
      adv_name: "Client",
      type: 1,
    });
    addContactState(hass, "binary_sensor.meshcore_contact_foreign", "foreign-hub", {
      public_key: "A1FFFFFFFFFF",
      adv_name: "Foreign Repeater",
      type: 2,
    });
    addContactState(
      hass,
      "binary_sensor.meshcore_contact_without_state",
      HUB_DEVICE_ID,
      { public_key: "D40000112233", adv_name: "Unavailable", type: 2 },
      false
    );
    const wrongPlatform = registryEntry(HUB_DEVICE_ID, "other");
    wrongPlatform.entity_id = "binary_sensor.other_contact";
    hass.entities[wrongPlatform.entity_id] = wrongPlatform;
    const wrongPlatformState = state("on", {
      public_key: "E50000112233",
      adv_name: "Other integration",
      type: 2,
    });
    wrongPlatformState.entity_id = wrongPlatform.entity_id;
    hass.states[wrongPlatform.entity_id] = wrongPlatformState;

    const row = await renderRoutedMessage(card, mock);
    const { dialogParams } = await openPathsDialog(card, row);

    expect(dialogParams.contacts).toEqual([
      { publicKey: "A10000112233", name: "Hill Repeater" },
      { publicKey: "B2", name: "Legacy Ridge", keyIsPrefix: true },
      { publicKey: "D4", name: "Prefix collision one", keyIsPrefix: true },
      { publicKey: "D4", name: "Prefix collision two", keyIsPrefix: true },
    ]);
    expect(dialogParams.contactsPromise).toBeUndefined();
  });

  it("sanitizes hostile state names and accepts documented legacy key attributes", async () => {
    const { card, mock, hass } = await createCard();
    addContactState(hass, "binary_sensor.meshcore_contact_hostile", HUB_DEVICE_ID, {
      pubkey_prefix: "a1b2c3",
      adv_name: ` Ridge\u202E  <img src=x onerror=alert(1)> `,
    });
    addContactState(hass, "binary_sensor.meshcore_contact_invalid", HUB_DEVICE_ID, {
      public_key: "not-hex",
      adv_name: "Invalid",
    });

    const row = await renderRoutedMessage(card, mock, "hostile contact");
    const { dialogParams } = await openPathsDialog(card, row);

    expect(dialogParams.contacts).toEqual([
      {
        publicKey: "A1B2C3",
        name: `Ridge <img src=x onerror=alert(1)>`,
        keyIsPrefix: true,
      },
    ]);
  });

  it("enriches data-only contacts through the exact primary configuration entry", async () => {
    const { card, mock, hass } = await createCard();
    hass.devices[HUB_DEVICE_ID]!.config_entries = ["other-entry", CONFIG_ENTRY_ID];
    const callWS = vi.fn().mockResolvedValue({
      response: {
        contacts: [
          {
            public_key: "A10000112233",
            pubkey_prefix: "A10000112233",
            adv_name: "Service Repeater",
            type: 2,
          },
          {
            public_key: "B20000112233",
            adv_name: "String Repeater",
            type: "repeater",
          },
          {
            public_key: "C30000112233",
            adv_name: "Not a repeater",
            type: 1,
          },
          {
            public_key: "A10000112233",
            adv_name: "Duplicate key",
            type: 2,
          },
        ],
      },
    });
    hass.callWS = callWS;

    const row = await renderRoutedMessage(card, mock, "service contacts");
    const { dialogParams } = await openPathsDialog(card, row);

    expect(callWS).toHaveBeenCalledWith({
      type: "call_service",
      domain: "meshcore",
      service: "get_contacts",
      service_data: { entry_id: CONFIG_ENTRY_ID },
      return_response: true,
    });
    expect(dialogParams.contacts).toEqual([]);
    await expect(dialogParams.contactsPromise).resolves.toEqual([
      { publicKey: "A10000112233", name: "Service Repeater" },
      { publicKey: "B20000112233", name: "String Repeater" },
    ]);
  });

  it("targets contacts through the selected entity's config entry on a shared device", async () => {
    const { card, mock, hass } = await createCard();
    hass.entities[CHANNEL_ENTITY]!.config_entry_id = "selected-channel-entry";
    hass.devices[HUB_DEVICE_ID]!.primary_config_entry = "other-entry";
    hass.devices[HUB_DEVICE_ID]!.config_entries = [
      "other-entry",
      "selected-channel-entry",
    ];
    const callWS = vi.fn().mockResolvedValue({ contacts: [] });
    hass.callWS = callWS;

    const row = await renderRoutedMessage(card, mock, "shared device contacts");
    const { dialogParams } = await openPathsDialog(card, row);
    await dialogParams.contactsPromise;

    expect(callWS).toHaveBeenCalledWith(
      expect.objectContaining({
        service_data: { entry_id: "selected-channel-entry" },
      })
    );
  });

  it("uses a sole configuration entry and skips ambiguous targeting", async () => {
    const sole = await createCard();
    sole.hass.devices[HUB_DEVICE_ID]!.primary_config_entry = null;
    sole.hass.devices[HUB_DEVICE_ID]!.config_entries = ["sole-entry", "sole-entry"];
    const soleCall = vi.fn().mockResolvedValue({ contacts: [] });
    sole.hass.callWS = soleCall;
    const soleRow = await renderRoutedMessage(
      sole.card,
      sole.mock,
      "sole entry"
    );
    const soleDialog = await openPathsDialog(sole.card, soleRow);
    await soleDialog.dialogParams.contactsPromise;
    expect(soleCall).toHaveBeenCalledWith(
      expect.objectContaining({ service_data: { entry_id: "sole-entry" } })
    );

    const ambiguous = await createCard();
    ambiguous.hass.devices[HUB_DEVICE_ID]!.primary_config_entry = null;
    ambiguous.hass.devices[HUB_DEVICE_ID]!.config_entries = ["one", "two"];
    const ambiguousCall = vi.fn().mockResolvedValue({ contacts: [] });
    ambiguous.hass.callWS = ambiguousCall;
    const ambiguousRow = await renderRoutedMessage(
      ambiguous.card,
      ambiguous.mock,
      "ambiguous entry"
    );
    const ambiguousDialog = await openPathsDialog(
      ambiguous.card,
      ambiguousRow
    );
    expect(ambiguousCall).not.toHaveBeenCalled();
    expect(ambiguousDialog.dialogParams.contactsPromise).toBeUndefined();
  });

  it("shares an in-flight request and caches one validated response for sixty seconds", async () => {
    const { card, mock, hass } = await createCard();
    addContactState(hass, "binary_sensor.meshcore_cached_contact", HUB_DEVICE_ID, {
      pubkey_prefix: "A10000",
      adv_name: "Cached",
      type: 2,
    });
    addContactState(hass, "binary_sensor.meshcore_exact_contact", HUB_DEVICE_ID, {
      public_key: "C30000112233",
      adv_name: "Stale exact name",
      type: 2,
    });
    addContactState(hass, "binary_sensor.meshcore_prefix_contact", HUB_DEVICE_ID, {
      pubkey_prefix: "D40000",
      adv_name: "Same prefix",
      type: 2,
    });
    let resolveResponse!: (value: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      resolveResponse = resolve;
    });
    const callWS = vi.fn().mockReturnValueOnce(response).mockResolvedValue({
      contacts: [
        { public_key: "B20000112233", adv_name: "Refreshed", type: 2 },
      ],
    });
    hass.callWS = callWS;
    const row = await renderRoutedMessage(card, mock, "cached contacts");

    const first = await openPathsDialog(card, row);
    const second = await openPathsDialog(card, row);
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(second.dialogParams.contactsPromise).toBe(
      first.dialogParams.contactsPromise
    );
    resolveResponse({
      contacts: [
        { public_key: "A10000112233", adv_name: "Cached", type: 2 },
        { public_key: "C30000112233", adv_name: "Fresh exact name", type: 2 },
        { public_key: "B20000112233", adv_name: "New cached contact", type: 2 },
        { pubkey_prefix: "D40000", adv_name: "Same prefix", type: 2 },
      ],
    });
    await expect(first.dialogParams.contactsPromise).resolves.toEqual([
      { publicKey: "A10000112233", name: "Cached" },
      { publicKey: "C30000112233", name: "Fresh exact name" },
      { publicKey: "B20000112233", name: "New cached contact" },
      { publicKey: "D40000", name: "Same prefix", keyIsPrefix: true },
    ]);

    const cached = await openPathsDialog(card, rowFor(card, "cached contacts"));
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(cached.dialogParams.contacts).toContainEqual({
      publicKey: "A10000112233",
      name: "Cached",
    });
    expect(cached.dialogParams.contacts).not.toContainEqual({
      publicKey: "A10000",
      name: "Cached",
    });
    expect(cached.dialogParams.contacts).toContainEqual({
      publicKey: "C30000112233",
      name: "Fresh exact name",
    });
    expect(cached.dialogParams.contacts).toContainEqual({
      publicKey: "B20000112233",
      name: "New cached contact",
    });
    expect(cached.dialogParams.contacts.filter(
      (contact) => contact.publicKey === "D40000"
    )).toEqual([
      { publicKey: "D40000", name: "Same prefix", keyIsPrefix: true },
    ]);
    expect(cached.dialogParams.contactsPromise).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60_001);
    const refreshed = await openPathsDialog(
      card,
      rowFor(card, "cached contacts")
    );
    expect(callWS).toHaveBeenCalledTimes(2);
    await expect(refreshed.dialogParams.contactsPromise).resolves.toEqual([
      { publicKey: "B20000112233", name: "Refreshed" },
    ]);
  });

  it("clears cached contacts when the Home Assistant connection changes", async () => {
    const { card, mock, hass } = await createCard();
    const callWS = vi.fn().mockResolvedValue({ contacts: [] });
    hass.callWS = callWS;
    const row = await renderRoutedMessage(card, mock, "connection cache");
    const initial = await openPathsDialog(card, row);
    await initial.dialogParams.contactsPromise;
    expect(callWS).toHaveBeenCalledTimes(1);

    const replacement = createConnection();
    hass.connection = replacement.connection;
    card.hass = hass;
    await vi.advanceTimersByTimeAsync(0);
    const reopened = await openPathsDialog(
      card,
      rowFor(card, "connection cache")
    );
    await reopened.dialogParams.contactsPromise;
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it("clears cached contacts when the selected channel target changes", async () => {
    const { card, mock, hass } = await createCard();
    const callWS = vi.fn().mockResolvedValue({ contacts: [] });
    hass.callWS = callWS;
    const initialRow = await renderRoutedMessage(card, mock, "target cache");
    const initial = await openPathsDialog(card, initialRow);
    await initial.dialogParams.contactsPromise;
    expect(callWS).toHaveBeenCalledTimes(1);

    card.setConfig({});
    card.setConfig({ entity: CHANNEL_ENTITY });
    await vi.advanceTimersByTimeAsync(0);
    const reopenedRow = await renderRoutedMessage(
      card,
      mock,
      "target cache reopened"
    );
    const reopened = await openPathsDialog(card, reopenedRow);
    await reopened.dialogParams.contactsPromise;
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["service error", { response: { contacts: [], error: "no_coordinator" } }],
    ["malformed response", { response: { contacts: "not-an-array" } }],
    ["missing response", { unexpected: true }],
  ])("degrades gracefully and retries after a %s", async (body, response) => {
    const { card, mock, hass } = await createCard();
    const callWS = vi.fn().mockResolvedValue(response);
    hass.callWS = callWS;
    const row = await renderRoutedMessage(card, mock, body);

    const first = await openPathsDialog(card, row);
    await expect(first.dialogParams.contactsPromise).resolves.toEqual([]);
    const second = await openPathsDialog(card, rowFor(card, body));
    await expect(second.dialogParams.contactsPromise).resolves.toEqual([]);
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it("handles rejected and synchronously unavailable response services", async () => {
    const rejected = await createCard();
    const rejectCall = vi.fn().mockRejectedValue(new Error("unauthorized"));
    rejected.hass.callWS = rejectCall;
    const rejectedRow = await renderRoutedMessage(
      rejected.card,
      rejected.mock,
      "rejected service"
    );
    const rejectedDialog = await openPathsDialog(rejected.card, rejectedRow);
    await expect(rejectedDialog.dialogParams.contactsPromise).resolves.toEqual([]);

    const throwing = await createCard();
    const throwCall = vi.fn(() => {
      throw new Error("unavailable");
    });
    throwing.hass.callWS = throwCall as unknown as HomeAssistant["callWS"];
    const throwingRow = await renderRoutedMessage(
      throwing.card,
      throwing.mock,
      "throwing service"
    );
    const throwingDialog = await openPathsDialog(throwing.card, throwingRow);
    expect(throwingDialog.dialogParams.contactsPromise).toBeUndefined();
    expect(throwCall).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale service result after disconnect and bounds responses", async () => {
    const { card, mock, hass } = await createCard();
    let resolveResponse!: (value: unknown) => void;
    const callWS = vi.fn().mockImplementation(
      () => new Promise<unknown>((resolve) => {
        resolveResponse = resolve;
      })
    );
    hass.callWS = callWS;
    const row = await renderRoutedMessage(card, mock, "stale service");
    const staleDialog = await openPathsDialog(card, row);
    card.remove();
    resolveResponse({
      contacts: [
        { public_key: "A10000112233", adv_name: "Stale", type: 2 },
      ],
    });
    await expect(staleDialog.dialogParams.contactsPromise).resolves.toEqual([]);

    const bounded = await createCard();
    bounded.hass.callWS = vi.fn().mockResolvedValue({
      contacts: Array.from({ length: 1_005 }, (_, index) => ({
        public_key: index.toString(16).padStart(4, "0"),
        adv_name: `Repeater ${index}`,
        type: 2,
      })),
    });
    const boundedRow = await renderRoutedMessage(
      bounded.card,
      bounded.mock,
      "bounded service"
    );
    const boundedDialog = await openPathsDialog(bounded.card, boundedRow);
    await expect(boundedDialog.dialogParams.contactsPromise).resolves.toHaveLength(
      1_000
    );
  });
});
