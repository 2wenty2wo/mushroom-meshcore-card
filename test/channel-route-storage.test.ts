import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../src/types.js";
import {
  CHANNEL_ROUTE_STORAGE_KEY,
  CHANNEL_ROUTE_STORAGE_VERSION,
  MAX_ROUTE_STORAGE_RECORDS,
  emptyRouteStorage,
  loadRouteStorage,
  loadRouteStorageResult,
  mergeRouteStorage,
  pruneRouteStorage,
  routeStorageIdentity,
  runSerializedRouteStorageWrite,
  saveRouteStorage,
  subscribeRouteStorage,
  validateRouteStorage,
} from "../src/channel-route-storage.js";

const route = {
  key: "AABB",
  hopCount: 1,
  pathSegments: ["AABB"],
  hashSizeBytes: 2 as const,
  direct: false,
  regionScoped: false,
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    when: 1_700_000_000,
    updatedAt: 1_700_000_000_000,
    outgoing: false,
    routes: [route],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("channel route storage", () => {
  it("validates, normalizes, and caps stored records", () => {
    const records: Record<string, unknown> = {};
    for (let index = 0; index < 205; index += 1) {
      records[`message-${index}`] = record({
        updatedAt: 1_700_000_000_000 + index,
        routes: [
          {
            ...route,
            pathSegments: [index % 2 ? "aabb" : "CCDD"],
          },
        ],
      });
    }
    const result = validateRouteStorage({
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: { "binary_sensor.meshcore_test_messages": records },
    });
    expect(
      Object.keys(result.targets["binary_sensor.meshcore_test_messages"] ?? {})
    ).toHaveLength(200);
    expect(
      result.targets["binary_sensor.meshcore_test_messages"]?.["message-0"]
    ).toBeUndefined();
    expect(
      result.targets["binary_sensor.meshcore_test_messages"]?.["message-204"]
        ?.routes[0]?.pathSegments
    ).toEqual(["CCDD"]);
  });

  it("ignores malformed records and wrong versions", () => {
    expect(validateRouteStorage({ version: 2, targets: {} })).toEqual(
      emptyRouteStorage()
    );
    const result = validateRouteStorage({
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: {
        channel: {
          valid: record(),
          malformed: { ...record(), routes: [{ ...route, pathSegments: ["NOPE"] }] },
          hostile: { ...record(), outgoingScope: "\u202e" },
        },
      },
    });
    expect(Object.keys(result.targets.channel ?? {})).toEqual(["valid"]);
    expect(
      validateRouteStorage({
        version: CHANNEL_ROUTE_STORAGE_VERSION,
        targets: { __proto__: { polluted: record() }, constructor: {} },
      })
    ).toEqual(emptyRouteStorage());
  });

  it("merges newer records while preserving independent targets", () => {
    const older = {
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: { first: { same: record(), old: record({ when: 1_699_000_000 }) } },
    };
    const newer = {
      version: CHANNEL_ROUTE_STORAGE_VERSION,
      targets: {
        first: { same: record({ updatedAt: 1_700_000_000_100, topHopCount: 4 }) },
        second: { other: record() },
      },
    };
    const result = mergeRouteStorage(older, newer);
    expect(result.targets.first?.same?.topHopCount).toBe(4);
    expect(result.targets.first?.old).toBeDefined();
    expect(result.targets.second?.other).toBeDefined();
  });

  it("prunes by history and global bounds", () => {
    const targets: Record<string, Record<string, unknown>> = {};
    for (let targetIndex = 0; targetIndex < 6; targetIndex += 1) {
      const records: Record<string, unknown> = {};
      for (let index = 0; index < 200; index += 1) {
        records[`${targetIndex}-${index}`] = record({
          when: 1_700_000_000 + targetIndex * 200 + index,
          updatedAt: 1_700_000_000_000 + targetIndex * 200_000 + index,
        });
      }
      targets[`target-${targetIndex}`] = records;
    }
    const result = pruneRouteStorage(
      { version: CHANNEL_ROUTE_STORAGE_VERSION, targets },
      { nowSeconds: 1_700_001_200, hoursToShow: 1, maxMessages: 200 }
    );
    const count = Object.values(result.targets).reduce(
      (total, records) => total + Object.keys(records).length,
      0
    );
    expect(count).toBeLessThanOrEqual(MAX_ROUTE_STORAGE_RECORDS);
    expect(result.targets["target-0"]).toBeUndefined();
  });

  it("applies configured retention only to the selected target", () => {
    const result = pruneRouteStorage(
      {
        version: CHANNEL_ROUTE_STORAGE_VERSION,
        targets: {
          selected: {
            old: record({ when: 1_699_990_000 }),
            newer: record({ when: 1_700_000_000, updatedAt: 1_700_000_000_100 }),
            newest: record({ when: 1_700_000_100, updatedAt: 1_700_000_100_000 }),
          },
          other: {
            old: record({ when: 1_699_990_000 }),
            newer: record({ when: 1_700_000_000, updatedAt: 1_700_000_000_100 }),
            newest: record({ when: 1_700_000_100, updatedAt: 1_700_000_100_000 }),
          },
        },
      },
      {
        targetId: "selected",
        nowSeconds: 1_700_000_200,
        hoursToShow: 1,
        maxMessages: 1,
      }
    );

    expect(Object.keys(result.targets.selected ?? {})).toEqual(["newest"]);
    expect(Object.keys(result.targets.other ?? {}).sort()).toEqual([
      "newer",
      "newest",
      "old",
    ]);
  });

  it("serializes writes sharing a Home Assistant connection", async () => {
    const connection = {} as NonNullable<HomeAssistant["connection"]>;
    const firstHass = { connection } as HomeAssistant;
    const secondHass = { connection } as HomeAssistant;
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const operation = (name: string) =>
      runSerializedRouteStorageWrite(
        name === "first" ? firstHass : secondHass,
        async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          order.push(`${name}:start`);
          await Promise.resolve();
          order.push(`${name}:end`);
          active -= 1;
          return name;
        }
      );

    await expect(Promise.all([operation("first"), operation("second")])).resolves
      .toEqual(["first", "second"]);
    expect(maximumActive).toBe(1);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);

    await expect(
      runSerializedRouteStorageWrite(firstHass, async () => {
        throw new Error("failed write");
      })
    ).rejects.toThrow("failed write");
    await expect(
      runSerializedRouteStorageWrite(secondHass, async () => "recovered")
    ).resolves.toBe("recovered");
  });

  it("prefers context identity and hashes the exact entry key", async () => {
    await expect(
      routeStorageIdentity({ contextId: " context-123 " })
    ).resolves.toBe("context:context-123");
    const identity = await routeStorageIdentity({ entryKey: "entry\u0000secret" });
    expect(identity).toMatch(/^(sha256|fallback):[0-9a-f]+$/);
    expect(identity).not.toContain("secret");
    vi.stubGlobal("crypto", undefined);
    const fallback = await routeStorageIdentity({ entryKey: "entry\u0000secret" });
    expect(fallback).toMatch(/^fallback:[0-9a-f]{16}$/);
    const derived = await routeStorageIdentity({
      entityId: "binary_sensor.meshcore_test_messages",
      when: 1_700_000_000,
      contextId: 42,
      message: "hello",
    });
    expect(derived).toMatch(/^fallback:[0-9a-f]{16}$/);
  });

  it("adapts Home Assistant load, save, and subscription messages", async () => {
    const callback = vi.fn();
    const unsubscribe = vi.fn();
    const callWS = vi.fn()
      .mockResolvedValueOnce({
        value: {
          version: CHANNEL_ROUTE_STORAGE_VERSION,
          targets: { channel: { message: record() } },
        },
      })
      .mockResolvedValueOnce({});
    const subscribeMessage = vi.fn(async (listener: (value: unknown) => void) => {
      listener({
        value: {
          version: CHANNEL_ROUTE_STORAGE_VERSION,
          targets: { remote: { message: record() } },
        },
      });
      return unsubscribe;
    });
    const hass = {
      callWS,
      connection: { subscribeMessage },
    } as unknown as HomeAssistant;

    await expect(loadRouteStorage(hass)).resolves.toHaveProperty(
      "targets.channel.message"
    );
    expect(callWS).toHaveBeenNthCalledWith(1, {
      type: "frontend/get_user_data",
      key: CHANNEL_ROUTE_STORAGE_KEY,
    });
    expect(await saveRouteStorage(hass, emptyRouteStorage())).toBe(true);
    expect(callWS).toHaveBeenNthCalledWith(2, {
      type: "frontend/set_user_data",
      key: CHANNEL_ROUTE_STORAGE_KEY,
      value: emptyRouteStorage(),
    });
    await expect(subscribeRouteStorage(hass, callback)).resolves.toBe(unsubscribe);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ version: CHANNEL_ROUTE_STORAGE_VERSION })
    );
    expect(subscribeMessage).toHaveBeenCalledWith(
      expect.any(Function),
      { type: "frontend/subscribe_user_data", key: CHANNEL_ROUTE_STORAGE_KEY },
      { resubscribe: false }
    );
  });

  it("degrades cleanly when the frontend storage API is unavailable", async () => {
    const hass = {} as HomeAssistant;
    await expect(loadRouteStorage(hass)).resolves.toEqual(emptyRouteStorage());
    await expect(saveRouteStorage(hass, emptyRouteStorage())).resolves.toBe(false);
    await expect(subscribeRouteStorage(hass, vi.fn())).resolves.toBeTypeOf("function");
    await expect(loadRouteStorageResult(hass)).resolves.toEqual({
      envelope: emptyRouteStorage(),
      available: false,
    });
  });

  it("handles rejected writes and subscriptions without throwing", async () => {
    const callWS = vi.fn().mockRejectedValue(new Error("write failed"));
    const rejectedSubscribe = vi.fn().mockRejectedValue(new Error("subscribe failed"));
    const hass = {
      callWS,
      connection: { subscribeMessage: rejectedSubscribe },
    } as unknown as HomeAssistant;
    await expect(saveRouteStorage(hass, emptyRouteStorage())).resolves.toBe(false);
    await expect(loadRouteStorageResult(hass)).resolves.toEqual({
      envelope: emptyRouteStorage(),
      available: false,
    });
    const unsubscribe = await subscribeRouteStorage(hass, vi.fn());
    expect(unsubscribe).toBeTypeOf("function");
    expect(rejectedSubscribe).toHaveBeenCalled();
  });
});
