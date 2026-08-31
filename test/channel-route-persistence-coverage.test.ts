import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreChannelCard } from "../src/channel-card.js";
import {
  CHANNEL_ROUTE_STORAGE_VERSION,
  emptyRouteStorage,
  type RouteStorageEnvelope,
  type RouteStorageRecord,
  type SerializedRoute,
} from "../src/channel-route-storage.js";
import type { HomeAssistant, MeshcoreChannelCardConfig } from "../src/types.js";
import {
  CHANNEL_ENTITY,
  createChannelHass,
  defineOnce,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);

const NOW = Math.floor(new Date("2026-08-25T12:00:00Z").getTime() / 1000);

interface TestLogbookEntry {
  when: number;
  name: string;
  message?: string;
  entity_id?: string;
  context_id?: string;
}

interface TestRoutingRecord {
  dialogId: string;
  entityId: string;
  sender: string;
  message: string;
  outgoing: boolean;
  timestampMs: number | null;
  eventTimeMs: number | null;
  contextId?: string;
  sendId?: string;
  signature?: string;
  topHopCount?: number;
  selectedRouteKey?: string;
  selectedRoute?: SerializedRoute;
  routes?: SerializedRoute[];
  outgoingScope?: string;
  messageEventSeen: boolean;
  matchedEntryKey?: string;
  matchedDistance?: number;
  matchAuthoritative?: boolean;
  updatedAt: number;
  hydratedFromStorage?: boolean;
  liveMetadataSeen?: boolean;
}

interface ChannelCardInternals {
  _entries: Map<string, TestLogbookEntry>;
  _routingRecords: Set<TestRoutingRecord>;
  _routingByEntry: Map<string, TestRoutingRecord>;
  _routingByContext: Map<string, TestRoutingRecord>;
  _routingBySignature: Map<string, TestRoutingRecord>;
  _pendingRouteStorageRecords: Map<string, TestRoutingRecord>;
  _routeStorage: RouteStorageEnvelope;
  _routeStorageLoaded: boolean;
  _routeStorageLoading: boolean;
  _routeStorageAvailable: boolean;
  _routeStorageGeneration: number;
  _routeStorageDirty: boolean;
  _routeStorageWriteRequested: boolean;
  _routeStorageWrite: Promise<void> | null;
  _routeStorageFlushTimer: ReturnType<typeof setTimeout> | null;
  _routeStorageUnsubscribe: (() => void | Promise<void>) | null;
  _ensureRouteStorage(): void;
  _hydrateStoredRoutes(): void;
  _hydrateStoredRoute(entry: TestLogbookEntry): Promise<void>;
  _pruneStoredRoutes(): void;
  _persistRoutingRecord(record: TestRoutingRecord): void;
  _scheduleRouteStorageWrite(): void;
  _flushRouteStorageWrite(): Promise<void>;
  _processMessageRouting(
    eventType: "meshcore_message" | "meshcore_delivery_update",
    envelope: Record<string, unknown>,
    data: Record<string, unknown>
  ): void;
  _entryKey(entry: TestLogbookEntry): string;
}

const pathRoute = (
  key = "1:A1",
  token = "A1"
): SerializedRoute => ({
  key,
  hopCount: 1,
  pathSegments: [token],
  hashSizeBytes: 1,
  direct: false,
  regionScoped: false,
});

const directRoute = (withKey = true): SerializedRoute => ({
  ...(withKey ? { key: "direct" } : {}),
  hopCount: 0,
  direct: true,
  regionScoped: false,
});

function storedRecord(
  routes: SerializedRoute[] = [pathRoute()],
  overrides: Partial<RouteStorageRecord> = {}
): RouteStorageRecord {
  return {
    when: NOW,
    updatedAt: NOW * 1000,
    outgoing: false,
    routes,
    ...overrides,
  };
}

function routingRecord(
  overrides: Partial<TestRoutingRecord> = {}
): TestRoutingRecord {
  const route = pathRoute();
  return {
    dialogId: "route-1",
    entityId: CHANNEL_ENTITY,
    sender: "Alice",
    message: "hello",
    outgoing: false,
    timestampMs: NOW * 1000,
    eventTimeMs: null,
    selectedRouteKey: route.key,
    selectedRoute: route,
    routes: [route],
    messageEventSeen: true,
    updatedAt: NOW * 1000,
    ...overrides,
  };
}

function entry(contextId: string, message = "Alice: hello"): TestLogbookEntry {
  return {
    when: NOW,
    name: "Public",
    entity_id: CHANNEL_ENTITY,
    context_id: contextId,
    message,
  };
}

function bareCard(
  callWS?: HomeAssistant["callWS"],
  config: MeshcoreChannelCardConfig = { entity: CHANNEL_ENTITY }
): {
  card: MeshcoreChannelCard;
  hass: HomeAssistant;
  internals: ChannelCardInternals;
} {
  const card = document.createElement(
    "mushroom-meshcore-channel-card"
  ) as MeshcoreChannelCard;
  card.setConfig(config);
  const hass = createChannelHass();
  if (callWS) hass.callWS = callWS;
  card.hass = hass;
  return {
    card,
    hass,
    internals: card as unknown as ChannelCardInternals,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

describe("channel route persistence coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("ignores stale loads and storage events and disposes a late subscription", async () => {
    const load = deferred<unknown>();
    const subscription = deferred<() => void>();
    const lateUnsubscribe = vi.fn();
    let storageCallback: ((message: unknown) => void) | undefined;
    const subscribeMessage = vi.fn(
      (callback: (message: unknown) => void, params: Record<string, unknown>) => {
        if (params["type"] === "frontend/subscribe_user_data") {
          storageCallback = callback;
          return subscription.promise;
        }
        return Promise.resolve(vi.fn());
      }
    );
    const callWS = vi.fn((message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") return load.promise;
      return Promise.resolve({});
    });
    const hass = createChannelHass();
    hass.connection = {
      subscribeMessage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as NonNullable<HomeAssistant["connection"]>;
    hass.callWS = callWS as unknown as NonNullable<HomeAssistant["callWS"]>;
    const card = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    card.setConfig({ entity: CHANNEL_ENTITY });
    card.hass = hass;
    document.body.appendChild(card);
    await flushMicrotasks();

    expect(storageCallback).toBeTypeOf("function");
    storageCallback!({ value: emptyRouteStorage() });
    await flushMicrotasks();
    card.setConfig({});
    storageCallback!({ value: emptyRouteStorage() });
    load.resolve({ value: emptyRouteStorage() });
    subscription.resolve(lateUnsubscribe);
    await flushMicrotasks(12);

    const internals = card as unknown as ChannelCardInternals;
    expect(internals._routeStorageLoaded).toBe(false);
    expect(internals._routeStorageUnsubscribe).toBeNull();
    expect(lateUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("hydrates every selected-route fallback and guards stale or superseded work", async () => {
    const { internals } = bareCard();
    internals._routeStorageLoaded = true;
    internals._routeStorageAvailable = true;

    const first = entry("first", "body without sender");
    const second = entry("second", "Alice: second");
    const third = entry("third", "Alice: third");
    const invalid = entry("invalid", "   ");
    const missingMessage = entry("missing-message");
    delete missingMessage.message;
    for (const item of [first, second, third, invalid, missingMessage]) {
      internals._entries.set(internals._entryKey(item), item);
    }
    const routeA = pathRoute("1:A1", "A1");
    const routeB = pathRoute("1:B2", "B2");
    internals._routeStorage = {
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: {
        [CHANNEL_ENTITY]: {
          "context:first": storedRecord([directRoute()]),
          "context:second": storedRecord([routeA, routeB], {
            selectedRoute: { ...routeB, pathSegments: ["B2"] },
          }),
          "context:third": storedRecord([routeA], {
            selectedRoute: directRoute(false),
          }),
          "context:invalid": storedRecord([routeA]),
          "context:missing-message": storedRecord([routeA]),
        },
      },
    };

    await internals._hydrateStoredRoute(first);
    await internals._hydrateStoredRoute(second);
    await internals._hydrateStoredRoute(third);
    await internals._hydrateStoredRoute(invalid);
    await internals._hydrateStoredRoute(missingMessage);

    const firstRecord = internals._routingByEntry.get(internals._entryKey(first));
    const secondRecord = internals._routingByEntry.get(internals._entryKey(second));
    const thirdRecord = internals._routingByEntry.get(internals._entryKey(third));
    expect(firstRecord?.sender).toBe("");
    expect(firstRecord?.selectedRouteKey).toBe("direct");
    expect(secondRecord?.selectedRouteKey).toBe("1:B2");
    expect(thirdRecord?.selectedRouteKey).toBe("1:A1");
    expect(internals._routingByEntry.has(internals._entryKey(invalid))).toBe(false);
    expect(
      internals._routingByEntry.has(internals._entryKey(missingMessage))
    ).toBe(false);

    const newer = entry("newer", "Alice: newer");
    const newerKey = internals._entryKey(newer);
    const live = routingRecord({
      matchedEntryKey: newerKey,
      hydratedFromStorage: false,
      updatedAt: NOW * 1000 + 10,
    });
    internals._entries.set(newerKey, newer);
    internals._routingByEntry.set(newerKey, live);
    internals._routeStorage.targets[CHANNEL_ENTITY]!["context:newer"] =
      storedRecord([routeA]);
    await internals._hydrateStoredRoute(newer);
    expect(internals._routingByEntry.get(newerKey)).toBe(live);

    const stale = entry("stale", "Alice: stale");
    internals._entries.set(internals._entryKey(stale), stale);
    internals._routeStorage.targets[CHANNEL_ENTITY]!["context:stale"] =
      storedRecord([routeA]);
    const staleHydration = internals._hydrateStoredRoute(stale);
    internals._routeStorageGeneration += 1;
    await staleHydration;
    expect(internals._routingByEntry.has(internals._entryKey(stale))).toBe(false);
  });

  it("drains queued records and prunes changed storage only when ready", () => {
    const { card, internals } = bareCard();
    const queued = routingRecord({ matchedEntryKey: "queued" });
    internals._pendingRouteStorageRecords.set("queued", queued);
    const persist = vi.fn();
    internals._persistRoutingRecord = persist;
    internals._hydrateStoredRoutes();
    expect(persist).toHaveBeenCalledWith(queued);

    const schedule = vi.fn();
    internals._scheduleRouteStorageWrite = schedule;
    internals._routeStorageLoaded = false;
    internals._pruneStoredRoutes();
    expect(schedule).not.toHaveBeenCalled();

    internals._routeStorageLoaded = true;
    card.setConfig({});
    internals._pruneStoredRoutes();
    expect(schedule).not.toHaveBeenCalled();

    const unconfigured = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    const unconfiguredInternals =
      unconfigured as unknown as ChannelCardInternals;
    unconfiguredInternals._routeStorageLoaded = true;
    unconfiguredInternals._pruneStoredRoutes();

    card.setConfig({ entity: CHANNEL_ENTITY, hours_to_show: 1 });
    internals._routeStorageLoaded = true;
    internals._routeStorage = {
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: {
        [CHANNEL_ENTITY]: {
          old: storedRecord([pathRoute()], { when: NOW - 7_200 }),
          current: storedRecord(),
        },
      },
    };
    internals._pruneStoredRoutes();
    expect(internals._routeStorage.targets[CHANNEL_ENTITY]?.old).toBeUndefined();
    expect(internals._routeStorage.targets[CHANNEL_ENTITY]?.current).toBeDefined();
    expect(schedule).toHaveBeenCalledTimes(1);

    const scheduled = bareCard().internals;
    scheduled._scheduleRouteStorageWrite();
    const timer = scheduled._routeStorageFlushTimer;
    scheduled._scheduleRouteStorageWrite();
    expect(scheduled._routeStorageFlushTimer).toBe(timer);
    if (timer !== null) clearTimeout(timer);
    scheduled._routeStorageFlushTimer = null;
  });

  it("persists minimal records and discards stale identity completions", async () => {
    const { internals } = bareCard();
    internals._routeStorageAvailable = true;
    internals._routeStorage = emptyRouteStorage();
    const schedule = vi.fn();
    internals._scheduleRouteStorageWrite = schedule;

    const waitingEntry = entry("waiting", "Alice: waiting");
    const waitingKey = internals._entryKey(waitingEntry);
    const waiting = routingRecord({
      message: "waiting",
      matchedEntryKey: waitingKey,
    });
    internals._entries.set(waitingKey, waitingEntry);
    internals._routingByEntry.set(waitingKey, waiting);
    internals._routeStorageLoaded = false;
    const ensureStorage = vi.fn();
    internals._ensureRouteStorage = ensureStorage;
    internals._persistRoutingRecord(waiting);
    expect(ensureStorage).toHaveBeenCalledTimes(1);
    expect(internals._pendingRouteStorageRecords.get(waitingKey)).toBe(waiting);

    internals._pendingRouteStorageRecords.delete(waitingKey);
    internals._routeStorageLoaded = true;

    const minimalEntry = entry("minimal", "Alice: minimal");
    const minimalKey = internals._entryKey(minimalEntry);
    const minimal = routingRecord({
      message: "minimal",
      matchedEntryKey: minimalKey,
      topHopCount: undefined,
      selectedRouteKey: undefined,
      selectedRoute: undefined,
      routes: [directRoute()],
      outgoingScope: undefined,
    });
    internals._entries.set(minimalKey, minimalEntry);
    internals._routingByEntry.set(minimalKey, minimal);
    internals._persistRoutingRecord(minimal);
    await flushMicrotasks();

    const stored = internals._routeStorage.targets[CHANNEL_ENTITY]?.["context:minimal"];
    expect(stored).toEqual(expect.objectContaining({ routes: [directRoute()] }));
    expect(stored).not.toHaveProperty("topHopCount");
    expect(stored).not.toHaveProperty("selectedRouteKey");
    expect(stored).not.toHaveProperty("selectedRoute");
    expect(stored).not.toHaveProperty("outgoingScope");

    const noRoutesEntry = entry("top-only", "Alice: top only");
    const noRoutesKey = internals._entryKey(noRoutesEntry);
    const noRoutes = routingRecord({
      message: "top only",
      matchedEntryKey: noRoutesKey,
      routes: undefined,
      selectedRoute: undefined,
      selectedRouteKey: undefined,
      topHopCount: 2,
      outgoingScope: "#au",
    });
    internals._entries.set(noRoutesKey, noRoutesEntry);
    internals._routingByEntry.set(noRoutesKey, noRoutes);
    internals._persistRoutingRecord(noRoutes);
    await flushMicrotasks();
    expect(
      internals._routeStorage.targets[CHANNEL_ENTITY]?.["context:top-only"]?.routes
    ).toEqual([]);
    expect(
      internals._routeStorage.targets[CHANNEL_ENTITY]?.["context:top-only"]
        ?.outgoingScope
    ).toBe("#au");

    const disappearingEntry = entry("disappearing", "Alice: disappearing");
    const disappearingKey = internals._entryKey(disappearingEntry);
    const disappearing = routingRecord({
      message: "disappearing",
      matchedEntryKey: disappearingKey,
    });
    internals._entries.set(disappearingKey, disappearingEntry);
    internals._routingByEntry.set(disappearingKey, disappearing);
    internals._persistRoutingRecord(disappearing);
    disappearing.routes = [];
    disappearing.selectedRoute = undefined;
    disappearing.selectedRouteKey = undefined;
    disappearing.topHopCount = undefined;
    disappearing.outgoingScope = undefined;
    await flushMicrotasks();
    expect(
      internals._routeStorage.targets[CHANNEL_ENTITY]?.["context:disappearing"]
    ).toBeUndefined();

    const staleEntry = entry("stale-persist", "Alice: stale persist");
    const staleKey = internals._entryKey(staleEntry);
    const stale = routingRecord({
      message: "stale persist",
      matchedEntryKey: staleKey,
    });
    internals._entries.set(staleKey, staleEntry);
    internals._routingByEntry.set(staleKey, stale);
    internals._persistRoutingRecord(stale);
    internals._routingByEntry.delete(staleKey);
    await flushMicrotasks();
    expect(
      internals._routeStorage.targets[CHANNEL_ENTITY]?.["context:stale-persist"]
    ).toBeUndefined();
    expect(schedule).toHaveBeenCalledTimes(2);

    const missingEntry = routingRecord({ matchedEntryKey: "missing" });
    internals._routingByEntry.set("missing", missingEntry);
    internals._persistRoutingRecord(missingEntry);
    await flushMicrotasks();
    expect(internals._pendingRouteStorageRecords.get("missing")).toBe(missingEntry);
  });

  it("queues a second flush while a write is active", async () => {
    const read = deferred<unknown>();
    const callWS = vi.fn((message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") return read.promise;
      return Promise.resolve({});
    });
    const { internals } = bareCard(
      callWS as unknown as NonNullable<HomeAssistant["callWS"]>
    );
    internals._routeStorage = emptyRouteStorage();
    internals._routeStorageDirty = true;
    const schedule = vi.fn();
    internals._scheduleRouteStorageWrite = schedule;

    const first = internals._flushRouteStorageWrite();
    await flushMicrotasks();
    expect(callWS).toHaveBeenCalledWith(
      expect.objectContaining({ type: "frontend/get_user_data" })
    );
    internals._routeStorageDirty = true;
    await internals._flushRouteStorageWrite();
    expect(internals._routeStorageWriteRequested).toBe(true);

    read.resolve({ value: emptyRouteStorage() });
    await first;
    expect(internals._routeStorageWriteRequested).toBe(false);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("abandons writes made stale before or after their read", async () => {
    const beforeCall = vi.fn().mockResolvedValue(emptyRouteStorage());
    const before = bareCard(
      beforeCall as unknown as NonNullable<HomeAssistant["callWS"]>
    ).internals;
    before._routeStorageDirty = true;
    before._scheduleRouteStorageWrite = vi.fn();
    const staleBefore = before._flushRouteStorageWrite();
    before._routeStorageGeneration += 1;
    await staleBefore;
    expect(beforeCall).not.toHaveBeenCalled();
    expect(before._routeStorageDirty).toBe(true);
    expect(before._scheduleRouteStorageWrite).toHaveBeenCalledTimes(1);

    const read = deferred<unknown>();
    const afterCall = vi.fn((message: Record<string, unknown>) =>
      message["type"] === "frontend/get_user_data"
        ? read.promise
        : Promise.resolve({})
    );
    const after = bareCard(
      afterCall as unknown as NonNullable<HomeAssistant["callWS"]>
    ).internals;
    after._routeStorageDirty = true;
    after._scheduleRouteStorageWrite = vi.fn();
    const staleAfter = after._flushRouteStorageWrite();
    await flushMicrotasks();
    after._routeStorageGeneration += 1;
    read.resolve({ value: emptyRouteStorage() });
    await staleAfter;
    expect(after._routeStorageDirty).toBe(true);
    expect(after._scheduleRouteStorageWrite).toHaveBeenCalledTimes(1);
    expect(
      afterCall.mock.calls.some(([message]) => message["type"] === "frontend/set_user_data")
    ).toBe(false);
  });

  it("handles raw reads, failed saves, rejected reads, and missing write support", async () => {
    const rawCall = vi.fn((message: Record<string, unknown>) => {
      if (message["type"] === "frontend/get_user_data") {
        return Promise.resolve(emptyRouteStorage());
      }
      return Promise.reject(new Error("set failed"));
    });
    const raw = bareCard(
      rawCall as unknown as NonNullable<HomeAssistant["callWS"]>
    ).internals;
    raw._routeStorageDirty = true;
    await raw._flushRouteStorageWrite();
    expect(rawCall).toHaveBeenCalledWith(
      expect.objectContaining({ type: "frontend/set_user_data" })
    );
    expect(raw._routeStorageDirty).toBe(false);

    const rejectedCall = vi.fn().mockRejectedValue(new Error("get failed"));
    const rejected = bareCard(
      rejectedCall as unknown as NonNullable<HomeAssistant["callWS"]>
    ).internals;
    rejected._routeStorageDirty = true;
    await rejected._flushRouteStorageWrite();
    expect(rejected._routeStorageDirty).toBe(false);

    const unsupported = bareCard().internals;
    unsupported._routeStorageDirty = false;
    await unsupported._flushRouteStorageWrite();
    unsupported._routeStorageDirty = true;
    await unsupported._flushRouteStorageWrite();
    expect(unsupported._routeStorageDirty).toBe(true);

    const missingTargetCall = vi.fn().mockResolvedValue(emptyRouteStorage());
    const missingTarget = bareCard(
      missingTargetCall as unknown as NonNullable<HomeAssistant["callWS"]>
    );
    missingTarget.card.setConfig({});
    missingTarget.internals._routeStorageDirty = true;
    await missingTarget.internals._flushRouteStorageWrite();
    expect(missingTargetCall).not.toHaveBeenCalled();
  });

  it("correlates the nearest hydrated record and preserves it for an empty live snapshot", () => {
    const { internals } = bareCard();
    const nearest = routingRecord({
      dialogId: "nearest",
      message: "persisted route",
      timestampMs: NOW * 1000 + 100,
      updatedAt: NOW * 1000 - 1_000,
      hydratedFromStorage: true,
      liveMetadataSeen: false,
    });
    const farther = routingRecord({
      dialogId: "farther",
      message: "persisted route",
      timestampMs: NOW * 1000 + 500,
      updatedAt: NOW * 1000 - 2_000,
      hydratedFromStorage: true,
      liveMetadataSeen: false,
    });
    const noise = [
      routingRecord({ hydratedFromStorage: false, message: "persisted route" }),
      routingRecord({ hydratedFromStorage: true, entityId: "other", message: "persisted route" }),
      routingRecord({ hydratedFromStorage: true, message: "other" }),
      routingRecord({ hydratedFromStorage: true, message: "persisted route", outgoing: true }),
      routingRecord({ hydratedFromStorage: true, message: "persisted route", timestampMs: null }),
    ];
    for (const record of [farther, ...noise, nearest]) {
      internals._routingRecords.add(record);
    }
    const originalRoute = nearest.routes?.[0];
    const previousUpdatedAt = nearest.updatedAt;

    internals._processMessageRouting(
      "meshcore_delivery_update",
      {},
      {
        entity_id: CHANNEL_ENTITY,
        sender_name: "Alice",
        message: "persisted route",
        outgoing: false,
        timestamp: NOW,
        rx_log_data: [],
      }
    );

    expect(nearest.routes?.[0]).toBe(originalRoute);
    expect(nearest.hydratedFromStorage).toBe(true);
    expect(nearest.updatedAt).toBe(previousUpdatedAt);
    expect(farther.signature).toBeUndefined();
  });
});
