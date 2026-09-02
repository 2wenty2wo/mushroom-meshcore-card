import { describe, expect, it } from "vitest";
import {
  discoverHubs,
  discoverNodes,
  findEntityByDevice,
  isDeviceOnHub,
} from "../src/discovery.js";
import type { HassEntityRegistryEntry, HomeAssistant } from "../src/types.js";
import {
  HUB_COUNT_ENTITY,
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  registryEntry,
  state,
} from "./fixtures.js";

describe("discoverHubs", () => {
  it("finds hubs from node_count sensors and derives pubkey and name", () => {
    const hubs = discoverHubs(createHass());
    expect(hubs).toEqual([
      {
        pubkey: HUB_PUBKEY,
        name: "test_hub",
        nodeCountEntity: HUB_COUNT_ENTITY,
        deviceId: HUB_DEVICE_ID,
      },
    ]);
  });

  it("falls back to the pubkey when the entity has no name suffix", () => {
    const hass = createHass();
    hass.states["sensor.meshcore_abc123_node_count"] = state(4);
    const hubs = discoverHubs(hass);
    const bare = hubs.find((hub) => hub.pubkey === "abc123");
    expect(bare?.name).toBe("abc123");
  });

  it("keeps one entry per pubkey", () => {
    const hass = createHass();
    hass.states[`sensor.meshcore_${HUB_PUBKEY}_node_count_other`] = state(9);
    const hubs = discoverHubs(hass);
    expect(hubs.filter((hub) => hub.pubkey === HUB_PUBKEY)).toHaveLength(1);
  });

  it("ignores unrelated sensors", () => {
    const hass = createHass();
    hass.states["sensor.meshcore_zz_node_count"] = state(1); // non-hex pubkey
    hass.states["sensor.other_node_count"] = state(1);
    expect(discoverHubs(hass).map((hub) => hub.pubkey)).toEqual([HUB_PUBKEY]);
  });
});

describe("discoverNodes", () => {
  it("returns non-hub meshcore devices with their entity prefix/suffix", () => {
    const nodes = discoverNodes(createHass());
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.name).toBe(NODE_NAME);
    expect(node.deviceId).toBe(NODE_DEVICE_ID);
    expect(node.ePrefix).toBe(NODE_PREFIX);
    expect(node.eSuffix).toBe(NODE_SUFFIX);
  });

  it("does not report the hub device as a node", () => {
    const nodes = discoverNodes(createHass());
    expect(nodes.some((node) => node.deviceId === HUB_DEVICE_ID)).toBe(false);
  });

  it("resolves the parent hub through via_device_id", () => {
    const nodes = discoverNodes(createHass());
    expect(nodes[0]!.hubPubkey).toBe(HUB_PUBKEY);
  });

  it("reports null hubPubkey when the device has no known parent", () => {
    const hass = createHass();
    delete hass.devices[NODE_DEVICE_ID]!.via_device_id;
    expect(discoverNodes(hass)[0]!.hubPubkey).toBeNull();
  });

  it("prefers the user-assigned device name", () => {
    const hass = createHass();
    hass.devices[NODE_DEVICE_ID]!.name_by_user = "My Repeater";
    expect(discoverNodes(hass)[0]!.name).toBe("My Repeater");
  });

  it("keeps the node-name suffix even when neighbor entities are the majority", () => {
    const hass = createHass();
    const neighborIds = [
      `${NODE_PREFIX}neighbor_count`,
      ...Array.from({ length: 12 }, (_, i) => {
        const hex = (0xa000 + i).toString(16);
        return [
          `${NODE_PREFIX}neighbor_${hex}`,
          `${NODE_PREFIX}neighbor_${hex}_seen`,
        ];
      }).flat(),
    ];
    for (const entityId of neighborIds) {
      hass.states[entityId] = state(1);
      hass.entities[entityId] = registryEntry(NODE_DEVICE_ID);
    }
    const node = discoverNodes(hass)[0]!;
    expect(node.eSuffix).toBe(NODE_SUFFIX);
    expect(node.ePrefix).toBe(NODE_PREFIX);
  });

  it("returns an empty list without registry data", () => {
    const bare = { states: {} } as unknown as HomeAssistant;
    expect(discoverNodes(bare)).toEqual([]);
  });
});

describe("isDeviceOnHub", () => {
  it("accepts the hub and its direct children without crossing hub boundaries", () => {
    const hass = createHass();
    hass.devices["foreign-hub"] = {
      ...hass.devices[HUB_DEVICE_ID]!,
      id: "foreign-hub",
    };
    hass.devices["foreign-child"] = {
      ...hass.devices[NODE_DEVICE_ID]!,
      id: "foreign-child",
      via_device_id: "foreign-hub",
    };

    expect(isDeviceOnHub(hass, HUB_DEVICE_ID, HUB_DEVICE_ID)).toBe(true);
    expect(isDeviceOnHub(hass, NODE_DEVICE_ID, HUB_DEVICE_ID)).toBe(true);
    expect(isDeviceOnHub(hass, "foreign-child", HUB_DEVICE_ID)).toBe(false);
    expect(isDeviceOnHub(hass, "missing-device", HUB_DEVICE_ID)).toBe(false);
    expect(isDeviceOnHub(hass, null, HUB_DEVICE_ID)).toBe(false);
  });
});

describe("findEntityByDevice", () => {
  const entities: Record<string, HassEntityRegistryEntry> = {
    [`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`]: registryEntry(NODE_DEVICE_ID),
    [`${NODE_PREFIX}last_rssi${NODE_SUFFIX}`]: registryEntry(NODE_DEVICE_ID),
    "sensor.other_device_battery_percentage": registryEntry("other-device"),
  };
  const find = (metric: string) =>
    findEntityByDevice(entities, NODE_DEVICE_ID, metric, NODE_PREFIX, NODE_SUFFIX);

  it("matches a metric after stripping the discovered prefix/suffix", () => {
    expect(find("battery_percentage")).toBe(
      `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`
    );
  });

  it("matches a metric as the last underscored segment", () => {
    expect(find("rssi")).toBe(`${NODE_PREFIX}last_rssi${NODE_SUFFIX}`);
  });

  it("prefers an exact metric core regardless of registry order", () => {
    const airtimeEntities: Record<string, HassEntityRegistryEntry> = {
      [`${NODE_PREFIX}rx_airtime${NODE_SUFFIX}`]: registryEntry(NODE_DEVICE_ID),
      [`${NODE_PREFIX}airtime${NODE_SUFFIX}`]: registryEntry(NODE_DEVICE_ID),
    };
    expect(
      findEntityByDevice(
        airtimeEntities,
        NODE_DEVICE_ID,
        "airtime",
        NODE_PREFIX,
        NODE_SUFFIX
      )
    ).toBe(`${NODE_PREFIX}airtime${NODE_SUFFIX}`);
  });

  it("never matches part of a longer metric name", () => {
    // `battery` must not resolve to `battery_percentage`.
    expect(find("battery")).toBeNull();
  });

  it("only considers entities of the requested device", () => {
    expect(
      findEntityByDevice(entities, "other-device", "rssi", "", "")
    ).toBeNull();
    expect(findEntityByDevice(entities, "", "rssi", NODE_PREFIX, NODE_SUFFIX)).toBeNull();
  });

  it("falls back to a plain _metric ending for legacy entity IDs", () => {
    // The discovered suffix fits most entities but not this outlier, so the
    // first (prefix/suffix-stripping) pass misses and the fallback must hit.
    const legacy: Record<string, HassEntityRegistryEntry> = {
      "sensor.node_temperature_home": registryEntry("legacy-device"),
      "sensor.node_battery": registryEntry("legacy-device"),
    };
    expect(
      findEntityByDevice(legacy, "legacy-device", "battery", "sensor.node_", "_home")
    ).toBe("sensor.node_battery");
  });
});
