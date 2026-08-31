import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreChannelCard } from "../src/channel-card.js";
import type { HomeAssistant } from "../src/types.js";
import {
  CHANNEL_ENTITY,
  createChannelHass,
  defineOnce,
} from "./fixtures.js";
import {
  CHANNEL_ROUTE_STORAGE_KEY,
  CHANNEL_ROUTE_STORAGE_VERSION,
  emptyRouteStorage,
} from "../src/channel-route-storage.js";

defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);

const NOW = Math.floor(new Date("2026-08-25T12:00:00Z").getTime() / 1000);

interface Subscription {
  callback: (message: unknown) => void;
  params: Record<string, unknown>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function makeConnection() {
  const subscriptions: Subscription[] = [];
  const subscribeMessage = vi.fn(
    (
      callback: (message: unknown) => void,
      params: Record<string, unknown>
    ) => {
      const subscription = {
        callback,
        params,
        unsubscribe: vi.fn(),
      };
      subscriptions.push(subscription);
      return Promise.resolve(subscription.unsubscribe);
    }
  );
  return {
    subscriptions,
    connection: {
      subscribeMessage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as NonNullable<HomeAssistant["connection"]>,
  };
}

function findSubscription(
  subscriptions: Subscription[],
  predicate: (params: Record<string, unknown>) => boolean
): Subscription {
  const result = subscriptions.find(({ params }) => predicate(params));
  expect(result).toBeDefined();
  return result!;
}

function routeEvent(
  subscriptions: Subscription[],
  eventType: string,
  data: Record<string, unknown>,
  contextId = "route-context"
): void {
  findSubscription(
    subscriptions,
    (params) => params["event_type"] === eventType
  ).callback({
    event_type: eventType,
    data,
    time_fired: new Date(NOW * 1000).toISOString(),
    context: { id: contextId },
  });
}

function logbook(
  subscriptions: Subscription[],
  message: string,
  contextId = "route-context"
): void {
  findSubscription(
    subscriptions,
    (params) => params["type"] === "logbook/event_stream"
  ).callback({
    events: [
      {
        when: NOW,
        name: "Public",
        entity_id: CHANNEL_ENTITY,
        context_id: contextId,
        message,
      },
    ],
  });
}

function broadcastRouteEvent(
  subscriptions: Subscription[],
  eventType: string,
  data: Record<string, unknown>,
  contextId: string
): void {
  for (const subscription of subscriptions) {
    if (subscription.params["event_type"] !== eventType) continue;
    subscription.callback({
      event_type: eventType,
      data,
      time_fired: new Date(NOW * 1000).toISOString(),
      context: { id: contextId },
    });
  }
}

function logbookForTarget(
  subscriptions: Subscription[],
  entityId: string,
  message: string,
  contextId: string
): void {
  findSubscription(
    subscriptions,
    (params) =>
      params["type"] === "logbook/event_stream" &&
      Array.isArray(params["entity_ids"]) &&
      params["entity_ids"].includes(entityId)
  ).callback({
    events: [
      {
        when: NOW,
        name: "Public",
        entity_id: entityId,
        context_id: contextId,
        message,
      },
    ],
  });
}

function broadcastLogbookForTarget(
  subscriptions: Subscription[],
  entityId: string,
  events: Array<{
    when: number;
    name: string;
    entity_id: string;
    context_id: string;
    message: string;
  }>
): void {
  for (const subscription of subscriptions) {
    if (
      subscription.params["type"] !== "logbook/event_stream" ||
      !Array.isArray(subscription.params["entity_ids"]) ||
      !subscription.params["entity_ids"].includes(entityId)
    ) {
      continue;
    }
    subscription.callback({ events });
  }
}

async function settle(milliseconds = 1_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
  await Promise.resolve();
}

describe("channel route frontend storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("persists matched native routing metadata and hydrates it on reload", async () => {
    let stored: unknown = emptyRouteStorage();
    const callWS = vi.fn(async (message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") {
        return { value: stored };
      }
      if (message["type"] === "frontend/set_user_data") {
        stored = message["value"];
      }
      return {};
    });

    const firstConnection = makeConnection();
    const firstHass = createChannelHass();
    firstHass.connection = firstConnection.connection;
    firstHass.callWS = callWS as unknown as NonNullable<HomeAssistant["callWS"]>;
    const first = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    first.setConfig({ entity: CHANNEL_ENTITY });
    first.hass = firstHass;
    document.body.appendChild(first);
    await settle(0);

    routeEvent(firstConnection.subscriptions, "meshcore_message", {
      message_type: "channel",
      entity_id: CHANNEL_ENTITY,
      channel_idx: 0,
      sender_name: "Alice",
      message: "hello",
      timestamp: NOW,
      hop_count: 2,
      rx_log_data: [
        {
          path_len: 2,
          path: "A1B2C3D4",
          path_hash_size: 2,
          region_scope: false,
          flood_scope: null,
        },
      ],
    });
    logbook(firstConnection.subscriptions, "Alice: hello");
    await settle();

    const setCalls = callWS.mock.calls.filter(
      ([message]) => message["type"] === "frontend/set_user_data"
    );
    expect(setCalls.length).toBeGreaterThan(0);
    const persisted = setCalls[setCalls.length - 1]?.[0]["value"] as {
      version: number;
      targets: Record<string, Record<string, { routes: unknown[]; updatedAt: number }>>;
    };
    expect(persisted.version).toBe(CHANNEL_ROUTE_STORAGE_VERSION);
    expect(persisted.targets[CHANNEL_ENTITY]).toBeDefined();
    expect(
      Object.values(persisted.targets[CHANNEL_ENTITY]!).some(
        (record) => record.routes.length === 1
      )
    ).toBe(true);

    first.remove();
    const secondConnection = makeConnection();
    const secondHass = createChannelHass();
    secondHass.connection = secondConnection.connection;
    secondHass.callWS = callWS as unknown as NonNullable<HomeAssistant["callWS"]>;
    const second = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    second.setConfig({ entity: CHANNEL_ENTITY });
    second.hass = secondHass;
    document.body.appendChild(second);
    await settle(0);
    logbook(secondConnection.subscriptions, "Alice: hello");
    await settle();

    const row = second.shadowRoot?.querySelector(".message-row");
    expect(row?.querySelector('ha-icon[icon="mdi:routes"]')).not.toBeNull();
    expect(row?.querySelector(".message-route-detail.bytes")).not.toBeNull();
    let dialogDetail: { dialogParams: { routes: readonly { pathSegments: readonly string[] }[] } } | undefined;
    second.addEventListener(
      "show-dialog",
      ((event: CustomEvent<typeof dialogDetail>) => {
        dialogDetail = event.detail;
      }) as EventListener,
      { once: true }
    );
    (row?.querySelector("button.message-route-detail.path") as HTMLButtonElement)?.click();
    expect(dialogDetail?.dialogParams.routes[0]?.pathSegments).toEqual(["A1B2", "C3D4"]);

    // A duplicate native event without routing fields must not erase the
    // hydrated metadata. A newer remote envelope is allowed to replace it.
    routeEvent(secondConnection.subscriptions, "meshcore_message", {
      message_type: "channel",
      entity_id: CHANNEL_ENTITY,
      channel_idx: 0,
      sender_name: "Alice",
      message: "hello",
      timestamp: NOW,
    });
    await settle(300);
    expect(second.shadowRoot?.querySelector(".message-route-detail.path")?.textContent).toContain("A1B2");

    // A remote last-writer-wins race can temporarily publish an envelope that
    // omits this card's record. The subscription merge must schedule a repair.
    const storageSubscription = findSubscription(
      secondConnection.subscriptions,
      (params) => params["type"] === "frontend/subscribe_user_data"
    );
    stored = emptyRouteStorage();
    storageSubscription.callback({ value: stored });
    await settle(1_000);
    expect(
      (stored as typeof persisted).targets[CHANNEL_ENTITY]
    ).toBeDefined();

    const targetRecords = persisted.targets[CHANNEL_ENTITY]!;
    const firstIdentity = Object.keys(targetRecords)[0]!;
    const remote = JSON.parse(JSON.stringify(persisted)) as typeof persisted;
    remote.targets[CHANNEL_ENTITY]![firstIdentity]!.updatedAt += 1_000;
    remote.targets[CHANNEL_ENTITY]![firstIdentity]!.routes = [
      {
        key: "1:EEFF",
        hopCount: 1,
        pathSegments: ["EEFF"],
        hashSizeBytes: 1,
        direct: false,
        regionScoped: false,
      },
    ];
    storageSubscription.callback({ value: remote });
    await settle(300);
    await Promise.resolve();
    await Promise.resolve();
    expect(second.shadowRoot?.querySelector(".message-route-detail.path")?.textContent).toContain("EEFF");

    second.setConfig({ entity: CHANNEL_ENTITY, hide_route_details: true });
    expect(second.shadowRoot?.querySelector(".message-route-details")).toBeNull();
    expect(stored).toEqual(expect.objectContaining({ version: CHANNEL_ROUTE_STORAGE_VERSION }));
    expect(callWS).toHaveBeenCalledWith({
      type: "frontend/get_user_data",
      key: CHANNEL_ROUTE_STORAGE_KEY,
    });
  });

  it("keeps target namespaces isolated and degrades when storage is unavailable", async () => {
    const connection = makeConnection();
    const hass = createChannelHass();
    hass.connection = connection.connection;
    hass.callWS = vi.fn().mockRejectedValue(new Error("storage unavailable")) as unknown as NonNullable<HomeAssistant["callWS"]>;
    const card = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    card.setConfig({ entity: CHANNEL_ENTITY });
    card.hass = hass;
    document.body.appendChild(card);
    await settle(0);
    routeEvent(connection.subscriptions, "meshcore_message", {
      message_type: "channel",
      entity_id: CHANNEL_ENTITY,
      sender_name: "Alice",
      message: "live",
      timestamp: NOW,
      hop_count: 0,
      rx_log_data: [
        {
          path_len: 0,
          path: "",
          path_hash_size: 1,
          region_scope: false,
          flood_scope: null,
        },
      ],
    });
    logbook(connection.subscriptions, "Alice: live");
    await settle();
    expect(card.shadowRoot?.querySelector(".message-route-details")).not.toBeNull();
    expect(hass.callWS).toHaveBeenCalled();
  });

  it("keeps shared same-channel storage independent of each card's visible history", async () => {
    const oldContext = "shared-old";
    const currentContext = "shared-current";
    const route = {
      key: "1:A1",
      hopCount: 1,
      pathSegments: ["A1"],
      hashSizeBytes: 1,
      direct: false,
      regionScoped: false,
    };
    let stored: unknown = {
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: {
        [CHANNEL_ENTITY]: {
          [`context:${oldContext}`]: {
            when: NOW - 7_200,
            updatedAt: (NOW - 7_200) * 1_000,
            outgoing: false,
            routes: [route],
          },
          [`context:${currentContext}`]: {
            when: NOW - 60,
            updatedAt: (NOW - 60) * 1_000,
            outgoing: false,
            routes: [route],
          },
        },
      },
    };
    const callWS = vi.fn(async (message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") {
        return { value: JSON.parse(JSON.stringify(stored)) };
      }
      if (message["type"] === "frontend/set_user_data") {
        stored = JSON.parse(JSON.stringify(message["value"]));
      }
      return {};
    });
    const sharedConnection = makeConnection();
    const hass = createChannelHass();
    hass.connection = sharedConnection.connection;
    hass.callWS = callWS as unknown as NonNullable<HomeAssistant["callWS"]>;

    const narrow = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    narrow.setConfig({
      entity: CHANNEL_ENTITY,
      hours_to_show: 1,
      max_messages: 1,
    });
    narrow.hass = hass;
    document.body.appendChild(narrow);

    const wide = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    wide.setConfig({
      entity: CHANNEL_ENTITY,
      hours_to_show: 168,
      max_messages: 200,
    });
    wide.hass = hass;
    document.body.appendChild(wide);
    await settle(0);

    callWS.mockClear();
    const publishSharedEnvelope = (): void => {
      for (const subscription of sharedConnection.subscriptions) {
        if (subscription.params["type"] !== "frontend/subscribe_user_data") {
          continue;
        }
        subscription.callback({ value: JSON.parse(JSON.stringify(stored)) });
      }
    };
    publishSharedEnvelope();

    broadcastLogbookForTarget(sharedConnection.subscriptions, CHANNEL_ENTITY, [
      {
        when: NOW - 7_200,
        name: "Public",
        entity_id: CHANNEL_ENTITY,
        context_id: oldContext,
        message: "Alice: old",
      },
      {
        when: NOW - 60,
        name: "Public",
        entity_id: CHANNEL_ENTITY,
        context_id: currentContext,
        message: "Alice: current",
      },
    ]);
    await settle(1_000);

    expect(narrow.shadowRoot?.querySelectorAll(".message-row")).toHaveLength(1);
    expect(wide.shadowRoot?.querySelectorAll(".message-row")).toHaveLength(2);
    expect(
      Object.keys(
        (stored as { targets: Record<string, Record<string, unknown>> }).targets[
          CHANNEL_ENTITY
        ] ?? {}
      )
    ).toEqual([
      `context:${oldContext}`,
      `context:${currentContext}`,
    ]);
    expect(
      callWS.mock.calls.filter(
        ([message]) => message["type"] === "frontend/set_user_data"
      )
    ).toHaveLength(0);

    // Replaying the shared namespace must remain a no-op for both cards rather
    // than causing the narrow card to delete and the wide card to repair it.
    publishSharedEnvelope();
    await settle(1_000);
    expect(
      callWS.mock.calls.filter(
        ([message]) => message["type"] === "frontend/set_user_data"
      )
    ).toHaveLength(0);
  });

  it("serializes simultaneous writes from separate channel-card instances", async () => {
    const secondEntity = "binary_sensor.meshcore_edfaf6_ch_1_messages";
    let stored: unknown = emptyRouteStorage();
    const callOrder: string[] = [];
    const callWS = vi.fn(async (message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") {
        callOrder.push("get");
        return { value: JSON.parse(JSON.stringify(stored)) };
      }
      if (message["type"] === "frontend/set_user_data") {
        callOrder.push("set");
        stored = JSON.parse(JSON.stringify(message["value"]));
      }
      return {};
    });
    const sharedConnection = makeConnection();
    const hass = createChannelHass();
    hass.connection = sharedConnection.connection;
    hass.callWS = callWS as unknown as NonNullable<HomeAssistant["callWS"]>;
    hass.states[secondEntity] = {
      ...hass.states[CHANNEL_ENTITY]!,
      entity_id: secondEntity,
      attributes: {
        ...hass.states[CHANNEL_ENTITY]!.attributes,
        friendly_name: "🌳 Test Hub (HA) Regional Messages",
        channel_index: 1,
      },
    };
    hass.entities[secondEntity] = {
      ...hass.entities[CHANNEL_ENTITY]!,
      entity_id: secondEntity,
    };

    const first = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    first.setConfig({ entity: CHANNEL_ENTITY });
    first.hass = hass;
    document.body.appendChild(first);
    const second = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    second.setConfig({ entity: secondEntity });
    second.hass = hass;
    document.body.appendChild(second);
    await settle(0);
    callWS.mockClear();
    callOrder.length = 0;

    broadcastRouteEvent(
      sharedConnection.subscriptions,
      "meshcore_message",
      {
        message_type: "channel",
        entity_id: CHANNEL_ENTITY,
        channel_idx: 0,
        sender_name: "Alice",
        message: "first",
        timestamp: NOW,
        hop_count: 1,
        rx_log_data: [
          {
            path_len: 1,
            path: "A1B2",
            path_hash_size: 2,
            region_scope: false,
            flood_scope: null,
          },
        ],
      },
      "first-context"
    );
    broadcastRouteEvent(
      sharedConnection.subscriptions,
      "meshcore_message",
      {
        message_type: "channel",
        entity_id: secondEntity,
        channel_idx: 1,
        sender_name: "Bob",
        message: "second",
        timestamp: NOW,
        hop_count: 1,
        rx_log_data: [
          {
            path_len: 1,
            path: "C3D4",
            path_hash_size: 2,
            region_scope: false,
            flood_scope: null,
          },
        ],
      },
      "second-context"
    );
    logbookForTarget(
      sharedConnection.subscriptions,
      CHANNEL_ENTITY,
      "Alice: first",
      "first-context"
    );
    logbookForTarget(
      sharedConnection.subscriptions,
      secondEntity,
      "Bob: second",
      "second-context"
    );
    await settle(1_000);

    const envelope = stored as {
      targets: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(envelope.targets[CHANNEL_ENTITY] ?? {})).toHaveLength(1);
    expect(Object.keys(envelope.targets[secondEntity] ?? {})).toHaveLength(1);
    expect(callOrder).toEqual(["get", "set", "get", "set"]);
  });
});
