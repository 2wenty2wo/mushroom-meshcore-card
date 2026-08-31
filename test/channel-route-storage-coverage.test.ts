import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../src/types.js";
import {
  CHANNEL_ROUTE_STORAGE_VERSION,
  MAX_ROUTE_STORAGE_HOPS,
  MAX_ROUTE_STORAGE_PATH_SEGMENTS,
  MAX_ROUTE_STORAGE_ROUTES,
  emptyRouteStorage,
  cloneRouteStorage,
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

const target = "binary_sensor.meshcore_demo_messages";
const route = {
  key: "AABB",
  hopCount: 1,
  pathSegments: ["AABB"],
  hashSizeBytes: 2 as const,
  direct: false,
  regionScoped: false,
  scope: "#au",
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

function envelope(records: Record<string, unknown> = { message: record() }) {
  return { version: CHANNEL_ROUTE_STORAGE_VERSION, targets: { [target]: records } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("channel route storage branch coverage", () => {
  it("rejects non-record roots, targets, and unsafe keys", () => {
    for (const value of [null, [], "cache", 42, { version: 1 }, { version: 1, targets: [] }]) {
      expect(validateRouteStorage(value)).toEqual(emptyRouteStorage());
    }
    expect(
      validateRouteStorage({
        version: CHANNEL_ROUTE_STORAGE_VERSION,
        targets: {
          __proto__: { message: record() },
          constructor: { message: record() },
          prototype: { message: record() },
          invalid: [],
          valid: { __proto__: record(), constructor: record(), prototype: record() },
        },
      })
    ).toEqual(emptyRouteStorage());
  });

  it("covers invalid route fields and route-size limits", () => {
    const invalidRoutes: unknown[] = [
      null,
      {},
      { direct: true },
      { regionScoped: false },
      { direct: true, regionScoped: false, key: "" },
      { direct: true, regionScoped: false, key: 123 },
      { direct: true, regionScoped: false, hopCount: -1 },
      { direct: true, regionScoped: false, hopCount: MAX_ROUTE_STORAGE_HOPS + 1 },
      { direct: true, regionScoped: false, hopCount: "1" },
      { direct: true, regionScoped: false, hashSizeBytes: 0 },
      { direct: true, regionScoped: false, hashSizeBytes: 4 },
      { direct: true, regionScoped: false, hashSizeBytes: "2" },
      { direct: true, regionScoped: false, scope: "\u202e" },
      { direct: true, regionScoped: false, pathSegments: null },
      { direct: true, regionScoped: false, pathSegments: [] },
      {
        direct: true,
        regionScoped: false,
        pathSegments: Array.from({ length: MAX_ROUTE_STORAGE_PATH_SEGMENTS + 1 }, () => "AA"),
      },
      { direct: true, regionScoped: false, pathSegments: ["A"] },
      { direct: true, regionScoped: false, pathSegments: ["AAAAAAA"] },
      { direct: true, regionScoped: false, pathSegments: ["AAA"] },
      { direct: true, regionScoped: false, pathSegments: ["GG"] },
      {
        direct: true,
        regionScoped: false,
        pathSegments: Array.from({ length: 2 }, () => 7),
      },
    ];
    for (const invalid of invalidRoutes) {
      expect(
        validateRouteStorage(envelope({ message: record({ routes: [invalid] }) }))
      ).toEqual(emptyRouteStorage());
    }
    const tooManyRoutes = Array.from({ length: MAX_ROUTE_STORAGE_ROUTES + 1 }, () => route);
    expect(validateRouteStorage(envelope({ message: record({ routes: tooManyRoutes }) }))).toEqual(
      emptyRouteStorage()
    );
    const validOptional = {
      direct: true,
      regionScoped: true,
      hopCount: 0,
      hashSizeBytes: 1,
      scope: "scope",
    };
    const normalized = validateRouteStorage(
      envelope({ message: record({ routes: [validOptional] }) })
    );
    expect(normalized.targets[target]?.message?.routes[0]).toEqual(validOptional);
  });

  it("rejects malformed records and selected-route data", () => {
    const invalidRecords: unknown[] = [
      null,
      [],
      {},
      record({ when: 0 }),
      record({ when: -1 }),
      record({ when: Infinity }),
      record({ updatedAt: 0 }),
      record({ updatedAt: "later" }),
      record({ outgoing: "false" }),
      record({ routes: {} }),
      record({ topHopCount: -1 }),
      record({ topHopCount: MAX_ROUTE_STORAGE_HOPS + 1 }),
      record({ topHopCount: "2" }),
      record({ selectedRouteKey: "" }),
      record({ selectedRouteKey: 1 }),
      record({ outgoingScope: "\u202e" }),
      record({ outgoingScope: 1 }),
      record({ routes: [route], selectedRoute: {} }),
      record({ routes: [route], selectedRoute: { ...route, hashSizeBytes: 7 } }),
    ];
    invalidRecords.forEach((invalid, index) => {
      expect(
        validateRouteStorage(envelope({ [`message-${index}`]: invalid }))
      ).toEqual(emptyRouteStorage());
    });
    expect(
      validateRouteStorage(
        envelope({ message: record({ routes: Array.from({ length: 1 }, () => route) }) })
      ).targets[target]?.message
    ).toBeDefined();
  });

  it("defensively clones optional route and record data", () => {
    const source = envelope({
      message: record({
        selectedRouteKey: "AABB",
        selectedRoute: route,
        topHopCount: 3,
        outgoingScope: "#au",
      }),
    });
    const cloned = cloneRouteStorage(source);
    expect(cloned).toEqual(source);
    cloned.targets[target]!["message"]!.routes[0]!.pathSegments![0] = "CCDD";
    const sourceMessage = source.targets[target]!["message"] as {
      routes: Array<{ pathSegments?: string[] }>;
    };
    expect(sourceMessage.routes[0]!.pathSegments![0]).toBe("AABB");
    expect(cloneRouteStorage(null)).toEqual(emptyRouteStorage());
  });

  it("handles prune inputs, invalid options, and retention selection", () => {
    expect(pruneRouteStorage(null)).toEqual(emptyRouteStorage());
    expect(pruneRouteStorage({ version: 2, targets: {} })).toEqual(emptyRouteStorage());
    expect(
      pruneRouteStorage({ version: CHANNEL_ROUTE_STORAGE_VERSION, targets: [] })
    ).toEqual(emptyRouteStorage());
    expect(
      pruneRouteStorage({
        version: CHANNEL_ROUTE_STORAGE_VERSION,
        targets: { constructor: { message: record() } },
      })
    ).toEqual(emptyRouteStorage());
    expect(
      pruneRouteStorage({
        version: CHANNEL_ROUTE_STORAGE_VERSION,
        targets: { [target]: { constructor: record() } },
      })
    ).toEqual(emptyRouteStorage());
    const source = envelope({
      old: record({ when: 1_699_000_000, updatedAt: 1_699_000_000_000 }),
      current: record({ when: 1_700_000_000, updatedAt: 1_700_000_000_000 }),
    });
    expect(
      Object.keys(
        pruneRouteStorage(source, {
          targetId: target,
          nowSeconds: 1_700_000_001,
          hoursToShow: -1,
          maxMessages: -1,
        }).targets[target] ?? {}
      )
    ).toHaveLength(2);
    expect(
      Object.keys(
        pruneRouteStorage(source, {
          targetId: target,
          nowSeconds: 1_700_000_001,
          hoursToShow: 1,
          maxMessages: 1,
        }).targets[target] ?? {}
      )
    ).toEqual(["current"]);
    expect(
      pruneRouteStorage(
        envelope({ expired: record({ when: 1_699_000_000 }) }),
        {
          targetId: target,
          nowSeconds: 1_700_000_001,
          hoursToShow: 1,
        }
      )
    ).toEqual(emptyRouteStorage());
    expect(
      pruneRouteStorage({ version: CHANNEL_ROUTE_STORAGE_VERSION, targets: { [target]: [] } })
    ).toEqual(emptyRouteStorage());
  });

  it("uses identity fallbacks when inputs and Web Crypto are unavailable", async () => {
    await expect(routeStorageIdentity({ entryKey: 123 })).resolves.toMatch(/^sha256:|^fallback:/);
    await expect(
      routeStorageIdentity({ entityId: "entity", when: 1, message: "message" })
    ).resolves.toMatch(/^sha256:|^fallback:/);
    await expect(
      routeStorageIdentity({ entityId: "entity", message: "message" })
    ).resolves.toMatch(/^sha256:|^fallback:/);
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockRejectedValue(new Error("crypto unavailable")) },
    });
    await expect(routeStorageIdentity({ entryKey: "opaque-key" })).resolves.toMatch(
      /^fallback:[0-9a-f]{16}$/
    );
    vi.stubGlobal("TextEncoder", undefined);
    await expect(routeStorageIdentity({ entryKey: "opaque-key" })).resolves.toMatch(
      /^fallback:[0-9a-f]{16}$/
    );
  });

  it("accepts direct websocket envelopes and reports storage availability", async () => {
    const callWS = vi.fn().mockResolvedValueOnce(envelope()).mockResolvedValueOnce({});
    const hass = { callWS } as unknown as HomeAssistant;
    await expect(loadRouteStorageResult(hass)).resolves.toEqual({
      envelope: expect.objectContaining({ version: CHANNEL_ROUTE_STORAGE_VERSION }),
      available: true,
    });
    await expect(loadRouteStorage(hass)).resolves.toEqual(emptyRouteStorage());
    expect(callWS).toHaveBeenCalledTimes(2);
    await expect(saveRouteStorage(hass, { version: 2 })).resolves.toBe(true);
    expect(callWS).toHaveBeenCalledTimes(3);
  });

  it("covers no-key serialized writes and preserves queue progress", async () => {
    const operation = vi.fn().mockResolvedValue("done");
    await expect(runSerializedRouteStorageWrite(undefined, operation)).resolves.toBe("done");
    await expect(
      runSerializedRouteStorageWrite({ connection: "not-a-connection" } as unknown as HomeAssistant, operation)
    ).resolves.toBe("done");
    const connection = {} as NonNullable<HomeAssistant["connection"]>;
    const hass = { connection } as HomeAssistant;
    await expect(
      runSerializedRouteStorageWrite(hass, async () => {
        throw new Error("expected failure");
      })
    ).rejects.toThrow("expected failure");
    await expect(runSerializedRouteStorageWrite(hass, async () => "next")).resolves.toBe("next");
  });

  it("handles subscription capability and callback failures", async () => {
    const callback = vi.fn();
    await expect(subscribeRouteStorage({ callWS: vi.fn() } as unknown as HomeAssistant, callback)).resolves.toBeTypeOf(
      "function"
    );
    const subscribeMessage = vi.fn().mockImplementation(async (listener: (message: unknown) => void) => {
      listener(envelope());
      return vi.fn();
    });
    const hass = {
      callWS: vi.fn(),
      connection: { subscribeMessage },
    } as unknown as HomeAssistant;
    await subscribeRouteStorage(hass, callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
    expect(await loadRouteStorage(undefined)).toEqual(emptyRouteStorage());
  });

  it("merges equal and older records deterministically", () => {
    const newer = envelope({ message: record({ topHopCount: 4, updatedAt: 1_700_000_000_010 }) });
    const older = envelope({ message: record({ topHopCount: 2, updatedAt: 1_700_000_000_001 }) });
    expect(mergeRouteStorage(newer, older).targets[target]?.message?.topHopCount).toBe(4);
    expect(mergeRouteStorage(older, newer).targets[target]?.message?.topHopCount).toBe(4);
  });
});
