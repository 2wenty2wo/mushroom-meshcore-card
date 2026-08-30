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

export const CHANNEL_ENTITY = "binary_sensor.meshcore_edfaf6_ch_0_messages";

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
