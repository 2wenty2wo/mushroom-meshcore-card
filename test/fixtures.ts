// Shared lightweight hass fixtures for unit tests. These mirror the entity
// naming used by the meshcore-ha integration (and the render-smoke fixtures)
// without pulling in a real Home Assistant environment.
import type { HassEntity } from "home-assistant-js-websocket";
import type {
  HassDeviceRegistryEntry,
  HassEntityRegistryEntry,
  HomeAssistant,
} from "../src/types.js";

export const HUB_PUBKEY = "55733c";
export const HUB_DEVICE_ID = "hub-device";
export const HUB_COUNT_ENTITY = `sensor.meshcore_${HUB_PUBKEY}_node_count_test_hub`;
export const HUB_STATUS_ENTITY = `sensor.meshcore_${HUB_PUBKEY}_node_status_test_hub`;

export const NODE_DEVICE_ID = "node-device";
export const NODE_NAME = "Spring Farm";
export const NODE_PREFIX = "sensor.meshcore_spring_";
export const NODE_SUFFIX = "_spring_farm";
export const NODE_ONLINE_ENTITY = "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm";

export const V29_REPEATER_METRICS = {
  tx_queue_len: 4,
  nb_sent_rate: 12.5,
  nb_recv_rate: 9.75,
  out_path: "flood",
  out_path_len: 2,
  bat: 4.21,
  sent_direct: 101,
  sent_flood: 102,
  recv_direct: 103,
  recv_flood: 104,
  direct_dups: 5,
  flood_dups: 6,
  full_evts: 7,
  recv_errors: 8,
  sent_direct_rate: 1.1,
  sent_flood_rate: 1.2,
  recv_direct_rate: 1.3,
  recv_flood_rate: 1.4,
  direct_dups_rate: 0.1,
  flood_dups_rate: 0.2,
  recv_errors_rate: 0.3,
  airtime: 17.5,
  rx_airtime: 8.25,
  request_successes: 33,
  request_failures: 2,
  rx_airtime_utilization: 1.75,
} as const;

export const CHANNEL_ENTITY = "binary_sensor.meshcore_edfaf6_ch_0_messages";
export const NODE_CONTACT_ENTITY =
  "binary_sensor.meshcore_spring_farm_a1b2c3d4e5f6_contact";
/** The contact's advertised pubkey, whose first 10 hex are what
 *  `NODE_ONLINE_ENTITY` carries — the overlap a contact is matched on. */
export const NODE_PUBKEY_PREFIX = "a1b2c3d4e5f6";
/** The device name as meshcore-ha actually publishes it: an integration prefix
 *  and a pubkey suffix around the advertised name, so it never equals
 *  `adv_name`. */
export const RENAMED_NODE_NAME = `MeshCore Repeater: ${NODE_NAME} (a1b2c3)`;

export function state(
  value: unknown,
  attributes: HassEntity["attributes"] = {},
  timestamp = new Date().toISOString()
): HassEntity {
  return {
    entity_id: "",
    state: String(value),
    attributes,
    last_changed: timestamp,
    last_updated: timestamp,
    context: { id: "test-context", user_id: null, parent_id: null },
  };
}

export function registryEntry(
  deviceId: string | null,
  platform = "meshcore"
): HassEntityRegistryEntry {
  return {
    entity_id: "",
    device_id: deviceId,
    platform,
    name: null,
    icon: null,
    disabled_by: null,
  };
}

export function device(
  id: string,
  overrides: Partial<HassDeviceRegistryEntry> = {}
): HassDeviceRegistryEntry {
  return {
    id,
    name: null,
    name_by_user: null,
    manufacturer: "MeshCore",
    model: null,
    ...overrides,
  };
}

export interface CreateHassOptions {
  online?: boolean;
  extraStates?: Record<string, HassEntity>;
  extraEntities?: Record<string, HassEntityRegistryEntry>;
}

/** One hub ("Test Hub", pubkey 55733c) plus one online repeater node
 *  ("Spring Farm") with the usual device-scoped MeshCore entities. */
export function createHass(options: CreateHassOptions = {}): HomeAssistant {
  const { online = true, extraStates = {}, extraEntities = {} } = options;
  const p = NODE_PREFIX.slice("sensor.".length);
  const nodeStates: Record<string, HassEntity> = {
    [`sensor.${p}uptime${NODE_SUFFIX}`]: state(online ? 1.5 : "unavailable"),
    [`sensor.${p}last_rssi${NODE_SUFFIX}`]: state(-26),
    [`sensor.${p}last_snr${NODE_SUFFIX}`]: state(11.25),
    [`sensor.${p}battery_percentage${NODE_SUFFIX}`]: state(90.33),
    [`sensor.${p}battery_voltage${NODE_SUFFIX}`]: state(4.08),
    [`sensor.${p}nb_sent${NODE_SUFFIX}`]: state(19175),
    [`sensor.${p}nb_recv${NODE_SUFFIX}`]: state(64487),
    [`sensor.${p}temperature${NODE_SUFFIX}`]: state(25),
    [`sensor.${p}last_advert${NODE_SUFFIX}`]: state(Math.floor(Date.now() / 1000) - 30),
    [`sensor.${p}airtime_utilization${NODE_SUFFIX}`]: state(2.5),
    [`sensor.${p}noise_floor${NODE_SUFFIX}`]: state(-114),
  };
  const states: Record<string, HassEntity> = {
    [HUB_COUNT_ENTITY]: state(2),
    [HUB_STATUS_ENTITY]: state("online", {
      hw_model: "Test Hub",
      firmware_version: "1.0",
    }),
    ...nodeStates,
    ...extraStates,
  };
  const entities: Record<string, HassEntityRegistryEntry> = {
    [HUB_COUNT_ENTITY]: registryEntry(HUB_DEVICE_ID),
    [HUB_STATUS_ENTITY]: registryEntry(HUB_DEVICE_ID),
    ...extraEntities,
  };
  for (const entityId of Object.keys(nodeStates)) {
    entities[entityId] = registryEntry(NODE_DEVICE_ID);
  }
  for (const [entityId, entry] of Object.entries(states)) entry.entity_id = entityId;
  for (const [entityId, entry] of Object.entries(entities)) entry.entity_id = entityId;
  return {
    states,
    entities,
    devices: {
      [HUB_DEVICE_ID]: device(HUB_DEVICE_ID, { name: "Test Hub", model: "Hub" }),
      [NODE_DEVICE_ID]: device(NODE_DEVICE_ID, {
        name: NODE_NAME,
        model: "Repeater",
        sw_version: "v1.14.0",
        via_device_id: HUB_DEVICE_ID,
      }),
    },
    themes: {},
    language: "en",
    locale: { language: "en" },
  };
}

/** A subscribed repeater exposing every canonical MeshCore HA 2.9 metric
 *  used by the card, including the canonical replacements for retained
 *  compatibility aliases. */
export function createV29RepeaterHass(): HomeAssistant {
  const hass = createHass();
  for (const [metric, value] of Object.entries(V29_REPEATER_METRICS)) {
    const entityId = `${NODE_PREFIX}${metric}${NODE_SUFFIX}`;
    const entityState = state(value);
    entityState.entity_id = entityId;
    hass.states[entityId] = entityState;
    const entry = registryEntry(NODE_DEVICE_ID);
    entry.entity_id = entityId;
    hass.entities[entityId] = entry;
  }
  return hass;
}

/** createHass plus the node's contact binary_sensor, carrying the routing
 *  attributes that the per-node `out_path_len` sensor reports as `unknown` on
 *  most real hardware.
 *
 *  Deliberately kept separate from `createHass`: every other fixture pairs the
 *  Spring Farm node with no matching contact, which is why the routing fallback
 *  stays dormant across the rest of the suite. Adding a contact to `createHass`
 *  would quietly change `path_length` and `route` chips everywhere.
 *
 *  Two traps if you extend the defaults: `adv_lat`/`adv_lon` would introduce a
 *  Location section and change `locationEntityId`, and merely having a matching
 *  contact promotes it ahead of `uptimeId` in `primaryEntityId`, so tests built
 *  on this fixture must not assert header more-info. */
export function createRoutingContactHass(
  attributes: Record<string, unknown> = { out_path: "", out_path_len: -1 },
  options: { sensors?: boolean } = {}
): HomeAssistant {
  const hass = options.sensors === false ? createHass() : createV29RepeaterHass();
  const contactState = state("fresh", {
    adv_name: NODE_NAME,
    pubkey_prefix: NODE_PUBKEY_PREFIX,
    ...attributes,
  });
  contactState.entity_id = NODE_CONTACT_ENTITY;
  hass.states[NODE_CONTACT_ENTITY] = contactState;
  const contactEntry = registryEntry(HUB_DEVICE_ID);
  contactEntry.entity_id = NODE_CONTACT_ENTITY;
  hass.entities[NODE_CONTACT_ENTITY] = contactEntry;
  return hass;
}

/** The node as meshcore-ha really presents it: the device name carries the
 *  integration's prefix and a pubkey suffix, so it never equals the contact's
 *  `adv_name`. Matching a contact by name cannot work here — the pubkey shared
 *  between the node's entity IDs and the contact's `pubkey_prefix` is what has
 *  to carry it. Target this hass with `RENAMED_NODE_NAME`. */
export function createRenamedNodeHass(
  attributes: Record<string, unknown> = { out_path: "", out_path_len: -1 }
): HomeAssistant {
  const hass = createRoutingContactHass(attributes);
  hass.devices[NODE_DEVICE_ID].name_by_user = RENAMED_NODE_NAME;
  // The hex-bearing entity ID is where the node's pubkey is read from; the
  // other fixture entities use a non-hex `spring` prefix.
  const onlineState = state("on");
  onlineState.entity_id = NODE_ONLINE_ENTITY;
  hass.states[NODE_ONLINE_ENTITY] = onlineState;
  const onlineEntry = registryEntry(NODE_DEVICE_ID);
  onlineEntry.entity_id = NODE_ONLINE_ENTITY;
  hass.entities[NODE_ONLINE_ENTITY] = onlineEntry;
  return hass;
}

export const OTHER_HUB_DEVICE_ID = "other-hub-device";
export const OTHER_HUB_CONTACT_ENTITY =
  "binary_sensor.meshcore_otherhub_spring_farm_a1b2c3d4e5f6_contact";

/** The same radio seen through a second hub. Both hubs publish a contact for
 *  the one pubkey, but `out_path` and `out_path_len` describe the route from
 *  *that* hub, so the values differ and only the node's own hub can answer for
 *  it. The rival is inserted ahead of the real contact, so a scan that ignores
 *  hub scope reaches the wrong one first. */
export function createMultiHubContactHass(): HomeAssistant {
  const hass = createRenamedNodeHass({ out_path: "", out_path_len: -1 });
  const rival = state("fresh", {
    adv_name: NODE_NAME,
    pubkey_prefix: NODE_PUBKEY_PREFIX,
    out_path: "aabb",
    out_path_len: 3,
  });
  rival.entity_id = OTHER_HUB_CONTACT_ENTITY;
  const rivalEntry = registryEntry(OTHER_HUB_DEVICE_ID);
  rivalEntry.entity_id = OTHER_HUB_CONTACT_ENTITY;
  hass.entities[OTHER_HUB_CONTACT_ENTITY] = rivalEntry;
  hass.devices[OTHER_HUB_DEVICE_ID] = device(OTHER_HUB_DEVICE_ID, {
    name: "Other Hub",
    model: "Hub",
  });
  hass.states = { [OTHER_HUB_CONTACT_ENTITY]: rival, ...hass.states };
  return hass;
}


/** The live Gilead case, as a fixture: the node routes through one hop whose
 *  token matches three hub contacts, only one of which it has heard directly.
 *
 *  Built to defeat the wrong implementations rather than merely to be
 *  realistic. The node's own `out_path` SENSOR says `"flood"` (as
 *  `createV29RepeaterHass` does), so anything reading the sensor's path with
 *  the contact's hop count produces nothing; the wrong repeater is listed
 *  first, so take-first names Mayfield; and a decoy contains "28" without
 *  starting with it, so substring matching reaches it. */
export function createRoutedNodeHass(
  options: { neighbor?: boolean; pathLen?: number; path?: string } = {}
): HomeAssistant {
  const hass = createRoutingContactHass({
    out_path: options.path ?? "28",
    out_path_len: options.pathLen ?? 1,
  });
  const rivals: Array<[string, string, string]> = [
    ["binary_sensor.meshcore_mayfield_28ba06be0540_contact", "28ba06be0540", "Mayfield backup"],
    ["binary_sensor.meshcore_mtannan_28c222747e12_contact", "28c222747e12", "Mount Annan Rpt"],
    ["binary_sensor.meshcore_vk1mcg_283f570a8c66_contact", "283f570a8c66", "VK1MCG"],
    ["binary_sensor.meshcore_decoy_ff28aa000000_contact", "ff28aa000000", "Decoy"],
  ];
  for (const [entityId, pubkey, advName] of rivals) {
    const st = state("fresh", { adv_name: advName, pubkey_prefix: pubkey });
    st.entity_id = entityId;
    hass.states[entityId] = st;
    const entry = registryEntry(HUB_DEVICE_ID);
    entry.entity_id = entityId;
    hass.entities[entityId] = entry;
  }
  if (options.neighbor !== false) {
    const neighborId = "sensor.meshcore_spring_neighbor_28c222";
    const entry = registryEntry(NODE_DEVICE_ID);
    entry.entity_id = neighborId;
    hass.entities[neighborId] = entry;
  }
  return hass;
}

/** createHass plus one channel messages binary_sensor on the hub device. */
export function createChannelHass(options: { channelState?: string } = {}): HomeAssistant {
  const hass = createHass();
  hass.devices[HUB_DEVICE_ID].name = "🌳 Test Hub (HA)";
  const channelState = state(options.channelState ?? "Active", {
    friendly_name: "🌳 Test Hub (HA) Public Messages",
    channel_index: 0,
  });
  channelState.entity_id = CHANNEL_ENTITY;
  hass.states[CHANNEL_ENTITY] = channelState;
  const channelEntry = registryEntry(HUB_DEVICE_ID);
  channelEntry.entity_id = CHANNEL_ENTITY;
  hass.entities[CHANNEL_ENTITY] = channelEntry;
  return hass;
}

/** The rendered ha-card markup of a card, without the inline stylesheet. */
export function shadowBody(element: HTMLElement): string {
  const html = element.shadowRoot?.innerHTML ?? "";
  return html.slice(html.indexOf("</style>") + "</style>".length);
}

export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
