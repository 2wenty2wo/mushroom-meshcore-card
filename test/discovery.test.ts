import { describe, expect, it } from "vitest";
import {
  discoverHubs,
  discoverNodes,
  findEntityByDevice,
  isDeviceOnHub,
  nodeSuffixCandidates,
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
    expect(node.eSuffixes).toEqual([NODE_SUFFIX]);
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
    expect(node.eSuffixes).toEqual([NODE_SUFFIX]);
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
    findEntityByDevice(entities, NODE_DEVICE_ID, metric, NODE_PREFIX, [NODE_SUFFIX]);

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
        [NODE_SUFFIX]
      )
    ).toBe(`${NODE_PREFIX}airtime${NODE_SUFFIX}`);
  });

  it("prefers a prefix-only exact metric when no suffix is discovered", () => {
    const suffixless: Record<string, HassEntityRegistryEntry> = {
      "sensor.node_rx_airtime": registryEntry("legacy-device"),
      "sensor.node_airtime": registryEntry("legacy-device"),
    };
    expect(
      findEntityByDevice(
        suffixless,
        "legacy-device",
        "airtime",
        "sensor.node_",
        []
      )
    ).toBe("sensor.node_airtime");
  });

  it("never matches part of a longer metric name", () => {
    // `battery` must not resolve to `battery_percentage`.
    expect(find("battery")).toBeNull();
  });

  it("only considers entities of the requested device", () => {
    expect(
      findEntityByDevice(entities, "other-device", "rssi", "", [])
    ).toBeNull();
    expect(
      findEntityByDevice(entities, "", "rssi", NODE_PREFIX, [NODE_SUFFIX])
    ).toBeNull();
  });

  it("resolves an entity that carries none of the discovered suffixes", () => {
    // No candidate matches this outlier, so its core keeps the full tail and
    // the exact pass still recognises it once the prefix is stripped.
    const legacy: Record<string, HassEntityRegistryEntry> = {
      "sensor.node_temperature_home": registryEntry("legacy-device"),
      "sensor.node_battery": registryEntry("legacy-device"),
    };
    expect(
      findEntityByDevice(legacy, "legacy-device", "battery", "sensor.node_", [
        "_home",
      ])
    ).toBe("sensor.node_battery");
  });

  it("falls back to a plain _metric ending when a suffix swallows the metric", () => {
    // Stripping `_seen` leaves the core as `last`, so both suffix-aware passes
    // miss and only the legacy raw-ID pass can still resolve the entity.
    const swallowed: Record<string, HassEntityRegistryEntry> = {
      "sensor.node_last_seen": registryEntry("legacy-device"),
    };
    expect(
      findEntityByDevice(swallowed, "legacy-device", "seen", "sensor.node_", [
        "_seen",
      ])
    ).toBe("sensor.node_last_seen");
  });
});

describe("nodeSuffixCandidates", () => {
  const device = { name: "MeshCore Spring Farm", name_by_user: null };

  it("offers the majority suffix first and the device slug alongside it", () => {
    const ids = [
      `${NODE_PREFIX}uptime${NODE_SUFFIX}`,
      `${NODE_PREFIX}last_rssi${NODE_SUFFIX}`,
      `${NODE_PREFIX}last_snr${NODE_SUFFIX}`,
    ];
    expect(nodeSuffixCandidates(device, ids)).toEqual([NODE_SUFFIX]);
  });

  it("keeps the majority suffix when the device name no longer matches it", () => {
    const ids = [
      `${NODE_PREFIX}uptime${NODE_SUFFIX}`,
      `${NODE_PREFIX}last_rssi${NODE_SUFFIX}`,
    ];
    const renamed = { name: "MeshCore Spring Farm", name_by_user: "Renamed" };
    expect(nodeSuffixCandidates(renamed, ids)).toEqual([NODE_SUFFIX]);
  });

  it("recovers both slugs of a device renamed after some entities existed", () => {
    const ids = [
      "sensor.meshcore_e963_uptime_mount_annan_mid",
      "sensor.meshcore_e963_last_rssi_mount_annan_mid",
      "sensor.meshcore_e963_battery_percentage_mount_annan_mid",
      "binary_sensor.meshcore_e963_online_mount_annan_2",
    ];
    const renamed = { name: "MeshCore Mount Annan Mid", name_by_user: "Mount Annan 2" };
    const candidates = nodeSuffixCandidates(renamed, ids);
    expect(candidates).toContain("_mount_annan_mid");
    expect(candidates).toContain("_mount_annan_2");
  });

  it("recovers the pre-rename slug from the entities alone", () => {
    // The device carries only the new name, so the old slug has to come from
    // the majority vote rather than from either name source.
    const ids = [
      "sensor.meshcore_e963_uptime_mount_annan_mid",
      "sensor.meshcore_e963_last_rssi_mount_annan_mid",
      "sensor.meshcore_e963_last_snr_mount_annan_mid",
      "sensor.meshcore_e963_noise_floor_mount_annan_mid",
      "binary_sensor.meshcore_e963_online_mount_annan_2",
    ];
    const candidates = nodeSuffixCandidates(
      { name: null, name_by_user: "Mount Annan 2" },
      ids
    );
    expect(candidates).toContain("_mount_annan_mid");
    expect(candidates).toContain("_mount_annan_2");
  });

  it("recovers an intermediate slug retained by exactly two entities", () => {
    // The device has since moved from its original name to its current name,
    // so neither registry name can predict the intermediate slug. Both leftover
    // entities carry `online`, making `_online_middle_ridge` another plausible
    // boundary in their strict common tail ahead of the true node slug.
    const binaryOnline =
      "binary_sensor.meshcore_e963_online_middle_ridge";
    const legacyOnline = "sensor.meshcore_e963_online_middle_ridge";
    const ids = [
      "sensor.meshcore_e963_uptime_original_ridge",
      "sensor.meshcore_e963_last_rssi_original_ridge",
      "sensor.meshcore_e963_last_snr_original_ridge",
      "sensor.meshcore_e963_battery_percentage_original_ridge",
      binaryOnline,
      legacyOnline,
    ];
    const candidates = nodeSuffixCandidates(
      { name: "MeshCore Original Ridge", name_by_user: "Current Ridge" },
      ids
    );
    // The connectivity resolver domain-filters before calling this shared
    // lookup, so exercise the same binary-only registry slice here.
    const entities: Record<string, HassEntityRegistryEntry> = {
      [binaryOnline]: registryEntry("multi-rename-device"),
    };

    expect(candidates).toContain("_middle_ridge");
    expect(
      findEntityByDevice(
        entities,
        "multi-rename-device",
        "online",
        "",
        candidates
      )
    ).toBe(binaryOnline);
  });

  it("still resolves metrics on a device too small for a clean majority", () => {
    // majoritySuffix returns a whole entity ID for one or two entities. The
    // per-entity length guard has to stop that candidate swallowing an entity.
    const uptime = "sensor.meshcore_e963_uptime_solo";
    const online = "binary_sensor.meshcore_e963_online_solo";
    const device = { name: "Solo", name_by_user: null };
    const entities: Record<string, HassEntityRegistryEntry> = {
      [uptime]: registryEntry("solo-device"),
      [online]: registryEntry("solo-device"),
    };
    const suffixes = nodeSuffixCandidates(device, [uptime, online]);
    expect(
      findEntityByDevice(entities, "solo-device", "uptime", "", suffixes)
    ).toBe(uptime);
    expect(
      findEntityByDevice(entities, "solo-device", "online", "", suffixes)
    ).toBe(online);
  });
});

describe("renamed devices", () => {
  // Regression: Home Assistant never rewrites existing entity IDs on a device
  // rename, so entities created afterwards carry a different slug. Matching on
  // a single majority suffix silently lost them.
  function renamedHass(): HomeAssistant {
    const hass = createHass();
    const onlineId = "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm_2";
    hass.states[onlineId] = state("on");
    hass.entities[onlineId] = registryEntry(NODE_DEVICE_ID);
    hass.entities[onlineId]!.entity_id = onlineId;
    hass.devices[NODE_DEVICE_ID]!.name_by_user = "Spring Farm 2";
    return hass;
  }

  it("resolves an entity created after the rename", () => {
    const node = discoverNodes(renamedHass())[0]!;
    expect(node.eSuffixes).toContain(NODE_SUFFIX);
    expect(node.eSuffixes).toContain("_spring_farm_2");
  });

  it("still resolves the pre-rename entities", () => {
    const hass = renamedHass();
    const node = discoverNodes(hass)[0]!;
    const scoped = Object.fromEntries(
      Object.entries(hass.entities).filter(
        ([, info]) => info.device_id === NODE_DEVICE_ID
      )
    );
    expect(
      findEntityByDevice(scoped, NODE_DEVICE_ID, "online", node.ePrefix, node.eSuffixes)
    ).toBe("binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm_2");
    expect(
      findEntityByDevice(scoped, NODE_DEVICE_ID, "battery_percentage", node.ePrefix, node.eSuffixes)
    ).toBe(`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`);
  });
});
