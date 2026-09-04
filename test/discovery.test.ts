import { describe, expect, it } from "vitest";
import {
  discoverHubs,
  discoverNodes,
  findEntityByDevice,
  findNodeContact,
  hubContacts,
  isDeviceOnHub,
  nodeNeighborIds,
  nodePubkey,
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
  device,
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

// Node identity resolution. These used to live as private methods on the card
// and could only be exercised through a rendered card, which is how several
// bugs hid: a test could pass because the name path was unreachable rather than
// because the rule under test held. Driven directly, each rule is its own case.
describe("nodePubkey", () => {
  const withEntities = (ids: string[]): HomeAssistant => {
    const hass = createHass();
    for (const id of ids) {
      const entry = registryEntry(NODE_DEVICE_ID);
      entry.entity_id = id;
      hass.entities[id] = entry;
    }
    return hass;
  };

  it("reads the token at every width integrations publish", () => {
    for (const [id, expected] of [
      ["binary_sensor.meshcore_e963_online_x", "e963"],
      ["binary_sensor.meshcore_b2c3d4_online_x", "b2c3d4"],
      ["binary_sensor.meshcore_a1b2c3d4e5_online_x", "a1b2c3d4e5"],
      ["sensor.meshcore_d476090a4924_bat_x", "d476090a4924"],
    ] as const) {
      expect(nodePubkey(withEntities([id]), NODE_DEVICE_ID), id).toBe(expected);
    }
  });

  it("ignores entities belonging to another device", () => {
    const hass = withEntities(["binary_sensor.meshcore_e963_online_x"]);
    hass.entities["binary_sensor.meshcore_e963_online_x"]!.device_id = "somewhere-else";
    expect(nodePubkey(hass, NODE_DEVICE_ID)).toBeNull();
  });

  it("returns null when no entity ID carries a hex token", () => {
    // The `spring` prefix in the shared fixture is the common real shape for
    // integrations that name entities after the node rather than its pubkey.
    expect(nodePubkey(createHass(), NODE_DEVICE_ID)).toBeNull();
    expect(nodePubkey(withEntities(["sensor.meshcore_abc_bat_x"]), NODE_DEVICE_ID)).toBeNull();
  });
});

describe("findNodeContact", () => {
  const CONTACT = "binary_sensor.meshcore_slug_a1b2c3d4e5f6_contact";

  /** A node on the hub, plus whatever contacts the case needs. */
  function withContacts(
    contacts: Array<{ id: string; attrs: Record<string, unknown>; device?: string }>,
    options: { nodePubkeyEntity?: string | null; hubless?: boolean } = {}
  ): HomeAssistant {
    const hass = createHass();
    if (options.hubless) hass.devices[NODE_DEVICE_ID]!.via_device_id = null;
    const pubkeyEntity =
      options.nodePubkeyEntity === undefined
        ? "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm"
        : options.nodePubkeyEntity;
    if (pubkeyEntity) {
      const entry = registryEntry(NODE_DEVICE_ID);
      entry.entity_id = pubkeyEntity;
      hass.entities[pubkeyEntity] = entry;
    }
    for (const { id, attrs, device } of contacts) {
      const st = state("fresh", attrs);
      st.entity_id = id;
      hass.states[id] = st;
      const entry = registryEntry(device ?? HUB_DEVICE_ID);
      entry.entity_id = id;
      hass.entities[id] = entry;
    }
    return hass;
  }

  it("matches on the pubkey shared with the contact's advert", () => {
    const hass = withContacts([
      { id: CONTACT, attrs: { adv_name: "anything else", pubkey_prefix: "a1b2c3d4e5f6" } },
    ]);
    expect(findNodeContact(hass, "a name that matches nothing", NODE_DEVICE_ID)).toBe(CONTACT);
  });

  it("refuses an ambiguous pubkey rather than guessing", () => {
    const rival = "binary_sensor.meshcore_other_a1b2c3d4e5ff_contact";
    const hass = withContacts([
      { id: rival, attrs: { adv_name: "Elsewhere", pubkey_prefix: "a1b2c3d4e5ff" } },
      { id: CONTACT, attrs: { adv_name: "Elsewhere too", pubkey_prefix: "a1b2c3d4e5f6" } },
    ], { nodePubkeyEntity: "binary_sensor.meshcore_a1b2_online_spring_farm" });
    expect(findNodeContact(hass, "no name match", NODE_DEVICE_ID)).toBeNull();
  });

  it("falls back to the advertised name when no pubkey is derivable", () => {
    const hass = withContacts(
      [{ id: CONTACT, attrs: { adv_name: NODE_NAME } }],
      { nodePubkeyEntity: null }
    );
    expect(findNodeContact(hass, NODE_NAME, NODE_DEVICE_ID)).toBe(CONTACT);
  });

  it("refuses an ambiguous name too", () => {
    // Two hubs publishing one radio share an adv_name, and route data is
    // hub-relative, so either answer would be a guess.
    const rival = "binary_sensor.meshcore_otherhub_ffff_contact";
    const hass = withContacts(
      [
        { id: rival, attrs: { adv_name: NODE_NAME } },
        { id: CONTACT, attrs: { adv_name: NODE_NAME } },
      ],
      { nodePubkeyEntity: null, hubless: true }
    );
    expect(findNodeContact(hass, NODE_NAME, NODE_DEVICE_ID)).toBeNull();
  });

  it("accepts a contact filed anywhere beneath the node's hub", () => {
    const hass = withContacts([
      { id: CONTACT, attrs: { adv_name: NODE_NAME, pubkey_prefix: "a1b2c3d4e5f6" }, device: "contact-own-device" },
    ]);
    hass.devices["contact-own-device"] = device("contact-own-device", {
      name: "Contact",
      via_device_id: HUB_DEVICE_ID,
    });
    expect(findNodeContact(hass, NODE_NAME, NODE_DEVICE_ID)).toBe(CONTACT);
  });

  it("rejects a contact belonging to a different hub", () => {
    const hass = withContacts([
      { id: CONTACT, attrs: { adv_name: NODE_NAME, pubkey_prefix: "a1b2c3d4e5f6" }, device: "other-hub" },
    ]);
    hass.devices["other-hub"] = device("other-hub", {
      name: "Other Hub",
      model: "Hub",
    });
    expect(findNodeContact(hass, NODE_NAME, NODE_DEVICE_ID)).toBeNull();
  });

  it("resolves a hubless node when exactly one contact answers", () => {
    const hass = withContacts(
      [{ id: CONTACT, attrs: { adv_name: NODE_NAME, pubkey_prefix: "a1b2c3d4e5f6" } }],
      { hubless: true }
    );
    expect(findNodeContact(hass, NODE_NAME, NODE_DEVICE_ID)).toBe(CONTACT);
  });

  it("returns null without a device id, having no identity to match on", () => {
    const hass = withContacts([
      { id: CONTACT, attrs: { adv_name: "Somebody", pubkey_prefix: "a1b2c3d4e5f6" } },
    ]);
    expect(findNodeContact(hass, "no such name")).toBeNull();
  });
});

describe("hubContacts", () => {
  function withContact(
    entityId: string,
    attrs: Record<string, unknown>,
    deviceId: string = HUB_DEVICE_ID,
    platform = "meshcore"
  ): HomeAssistant {
    const hass = createHass();
    const st = state("fresh", attrs);
    st.entity_id = entityId;
    hass.states[entityId] = st;
    const entry = registryEntry(deviceId, platform);
    entry.entity_id = entityId;
    hass.entities[entityId] = entry;
    return hass;
  }
  const CONTACT = "binary_sensor.meshcore_rpt_a1b2c3d4e5f6_contact";
  const ADVERT = { adv_name: "Repeater One", pubkey_prefix: "a1b2c3d4e5f6" };

  it("reports the contact's identity and the entity that published it", () => {
    expect(hubContacts(withContact(CONTACT, ADVERT), HUB_DEVICE_ID)).toEqual([
      { entityId: CONTACT, publicKey: "A1B2C3D4E5F6", name: "Repeater One", keyIsPrefix: true },
    ]);
  });

  it("includes contacts filed on devices beneath the hub", () => {
    const hass = withContact(CONTACT, ADVERT, "child-device");
    hass.devices["child-device"] = device("child-device", { via_device_id: HUB_DEVICE_ID });
    expect(hubContacts(hass, HUB_DEVICE_ID).map((c) => c.entityId)).toEqual([CONTACT]);
  });

  it("excludes contacts belonging to a different hub", () => {
    const hass = withContact(CONTACT, ADVERT, "other-hub");
    hass.devices["other-hub"] = device("other-hub", { model: "Hub" });
    expect(hubContacts(hass, HUB_DEVICE_ID)).toEqual([]);
  });

  it("excludes entities from another integration", () => {
    expect(hubContacts(withContact(CONTACT, ADVERT, HUB_DEVICE_ID, "other"), HUB_DEVICE_ID))
      .toEqual([]);
  });

  it("returns nothing without a hub to scope to", () => {
    expect(hubContacts(withContact(CONTACT, ADVERT), null)).toEqual([]);
  });

  it("prefers a complete public key over a prefix", () => {
    const hass = withContact(CONTACT, { ...ADVERT, public_key: "a".repeat(64) });
    const [contact] = hubContacts(hass, HUB_DEVICE_ID);
    expect(contact!.publicKey).toBe("A".repeat(64));
    expect(contact!.keyIsPrefix).toBeUndefined();
  });

  it("drops an advert with no usable name", () => {
    expect(hubContacts(withContact(CONTACT, { pubkey_prefix: "a1b2c3d4e5f6" }), HUB_DEVICE_ID))
      .toEqual([]);
  });
});

describe("nodeNeighborIds", () => {
  function withNeighborEntities(ids: string[]): HomeAssistant {
    const hass = createHass();
    for (const id of ids) {
      const entry = registryEntry(NODE_DEVICE_ID);
      entry.entity_id = id;
      hass.entities[id] = entry;
    }
    return hass;
  }

  it("collects the hex from neighbour entity IDs, deduping the _seen pair", () => {
    const hass = withNeighborEntities([
      "sensor.meshcore_spring_neighbor_28c222",
      "sensor.meshcore_spring_neighbor_28c222_seen",
      "sensor.meshcore_spring_neighbor_e963cb",
    ]);
    expect(nodeNeighborIds(hass, NODE_DEVICE_ID).sort()).toEqual(["28c222", "e963cb"]);
  });

  it("does not mistake the neighbour count sensor for a neighbour", () => {
    const hass = withNeighborEntities(["sensor.meshcore_spring_neighbor_count"]);
    expect(nodeNeighborIds(hass, NODE_DEVICE_ID)).toEqual([]);
  });

  it("ignores neighbours belonging to another device", () => {
    const hass = withNeighborEntities(["sensor.meshcore_spring_neighbor_28c222"]);
    hass.entities["sensor.meshcore_spring_neighbor_28c222"]!.device_id = "elsewhere";
    expect(nodeNeighborIds(hass, NODE_DEVICE_ID)).toEqual([]);
  });

  it("returns nothing for a device exposing no neighbours", () => {
    expect(nodeNeighborIds(createHass(), NODE_DEVICE_ID)).toEqual([]);
  });
});
