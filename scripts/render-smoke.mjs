import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class FakeShadowRoot {
  _innerHTML = "";
  tileInfos = [];
  historyElement = null;
  listeners = new Map();

  set innerHTML(value) {
    this._innerHTML = value;
    this.tileInfos = Array.from(value.matchAll(/<ha-tile-info>([\s\S]*?)<\/ha-tile-info>/g), ([, contents]) => ({
      primary: undefined,
      secondary: undefined,
      querySelector: (selector) => {
        const slot = selector.includes("primary") ? "primary" : "secondary";
        const match = contents.match(new RegExp(`<span slot="${slot}">([\\s\\S]*?)<\\/span>`));
        return match ? { textContent: match[1] } : null;
      },
    }));
    if (value.includes('class="channel-history"')) {
      const rowCount = (value.match(/class="message-row"/g) ?? []).length;
      this.historyElement = {
        scrollTop: 0,
        scrollHeight: 100 + rowCount * 100,
        clientHeight: 385,
      };
    } else {
      this.historyElement = null;
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  querySelector(selector) {
    if (selector === "ha-tile-info") return this.tileInfos[0] ?? null;
    if (selector === ".channel-history") return this.historyElement;
    return null;
  }

  querySelectorAll(selector) {
    return selector === "ha-tile-info" ? this.tileInfos : [];
  }
}

class FakeHTMLElement {
  shadowRoot = null;
  style = {};
  lastEvent = null;
  children = [];
  listeners = new Map();

  constructor(tagName = "") {
    this.tagName = tagName.toUpperCase();
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot();
    return this.shadowRoot;
  }

  dispatchEvent(event) {
    this.lastEvent = event;
    return true;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }

  get lastChild() {
    return this.children.at(-1) ?? null;
  }

  querySelectorAll(selector) {
    const tagName = selector.toUpperCase();
    const matches = [];
    for (const child of this.children) {
      if (child.tagName === tagName) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

const registry = new Map();
globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  get: (name) => registry.get(name),
  define: (name, constructor) => registry.set(name, constructor),
};
customElements.define("ha-tile-info", class extends FakeHTMLElement {});
globalThis.window = { customCards: [] };
globalThis.document = {
  createElement: (tagName) => new FakeHTMLElement(tagName),
};
globalThis.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const bundle = readFileSync(new URL("../dist/mushroom-meshcore-card.js", import.meta.url), "utf8");
Function(bundle)();

const MainCard = registry.get("mushroom-meshcore-card");
assert.ok(MainCard, "main card is registered");

const timestamp = new Date().toISOString();
const state = (value, attributes = {}) => ({
  state: String(value),
  attributes,
  last_changed: timestamp,
  last_updated: timestamp,
});
const registryEntry = (deviceId) => ({
  device_id: deviceId,
  platform: "meshcore",
  name: null,
  icon: null,
  disabled_by: null,
});

function createHass(online = true) {
  const hubCount = "sensor.meshcore_55733c_node_count_test_hub";
  const hubStatus = "sensor.meshcore_55733c_node_status_test_hub";
  const prefix = "sensor.meshcore_spring_";
  const suffix = "_spring_farm";
  const nodeEntities = {
    [`${prefix}uptime${suffix}`]: state(online ? 1.5 : "unavailable"),
    [`${prefix}last_rssi${suffix}`]: state(-26),
    [`${prefix}last_snr${suffix}`]: state(11.25),
    [`${prefix}battery_percentage${suffix}`]: state(90.33),
    [`${prefix}bat${suffix}`]: state(4.21),
    [`${prefix}battery_voltage${suffix}`]: state(4.08),
    [`${prefix}nb_sent${suffix}`]: state(19175),
    [`${prefix}nb_recv${suffix}`]: state(64487),
    [`${prefix}temperature${suffix}`]: state(25),
    [`${prefix}last_advert${suffix}`]: state(Math.floor(Date.now() / 1000) - 30),
    [`${prefix}airtime_utilization${suffix}`]: state(2.5),
    [`${prefix}rx_airtime_utilization${suffix}`]: state(1.75),
    [`${prefix}airtime${suffix}`]: state(17.5),
    [`${prefix}tx_queue_len${suffix}`]: state(4),
    [`${prefix}nb_sent_rate${suffix}`]: state(12.5),
    [`${prefix}nb_recv_rate${suffix}`]: state(9.75),
    [`${prefix}out_path${suffix}`]: state("flood"),
    [`${prefix}out_path_len${suffix}`]: state(2),
    [`${prefix}sent_direct${suffix}`]: state(101),
    [`${prefix}recv_errors${suffix}`]: state(8),
    [`${prefix}request_failures${suffix}`]: state(2),
    [`${prefix}noise_floor${suffix}`]: state(-114),
  };
  const states = {
    [hubCount]: state(2),
    [hubStatus]: state("online", { hw_model: "Test Hub", firmware_version: "1.0" }),
    ...nodeEntities,
  };
  const entities = {
    [hubCount]: registryEntry("hub-device"),
    [hubStatus]: registryEntry("hub-device"),
  };
  for (const entityId of Object.keys(nodeEntities)) {
    entities[entityId] = registryEntry("node-device");
  }
  return {
    states,
    entities,
    devices: {
      "hub-device": {
        id: "hub-device",
        name: "Test Hub",
        name_by_user: null,
        manufacturer: "MeshCore",
        model: "Hub",
      },
      "node-device": {
        id: "node-device",
        name: "Spring Farm",
        name_by_user: null,
        manufacturer: "MeshCore",
        model: "Repeater",
        sw_version: "v1.14.0",
        via_device_id: "hub-device",
      },
    },
    themes: {},
    language: "en",
    locale: { language: "en" },
  };
}

function createLogbookConnection({ reject = false } = {}) {
  const subscriptions = [];
  const readyListeners = new Set();
  return {
    subscriptions,
    subscribeMessage(callback, params, options) {
      if (reject) return Promise.reject(new Error("Logbook unavailable"));
      const subscription = {
        callback,
        params,
        options,
        unsubscribed: false,
      };
      subscriptions.push(subscription);
      return Promise.resolve(() => {
        subscription.unsubscribed = true;
      });
    },
    addEventListener(type, listener) {
      if (type === "ready") readyListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "ready") readyListeners.delete(listener);
    },
    emitReady() {
      for (const listener of readyListeners) listener();
    },
  };
}

const CHANNEL_ENTITY = "binary_sensor.meshcore_edfaf6_ch_0_messages";
const SECOND_CHANNEL_ENTITY = "binary_sensor.meshcore_edfaf6_ch_1_messages";
const MENTIONS_ENTITY = "todo.meshcore_tags";
const SECOND_MENTIONS_ENTITY = "todo.meshcore_mentions_archive";

function createChannelHass({ unavailable = false, reject = false } = {}) {
  const hass = createHass();
  hass.devices["hub-device"].name = "🌳 2wenty2wo (HA)";
  hass.states[CHANNEL_ENTITY] = state(unavailable ? "unavailable" : "Active", {
    friendly_name: "🌳 2wenty2wo (HA) Public Messages",
    channel_index: 0,
  });
  hass.states[SECOND_CHANNEL_ENTITY] = state("Active", {
    friendly_name: "🌳 2wenty2wo (HA) #macarthur Messages",
    channel_index: 1,
  });
  hass.entities[CHANNEL_ENTITY] = registryEntry("hub-device");
  hass.entities[SECOND_CHANNEL_ENTITY] = registryEntry("hub-device");
  hass.locale = {
    language: "en",
    time_format: "24",
    time_zone: "server",
  };
  hass.config = { components: ["logbook"], time_zone: "Australia/Sydney" };
  hass.connection = createLogbookConnection({ reject });
  return hass;
}

function createMentionsHass({ unavailable = false, reject = false, callService } = {}) {
  const hass = createHass();
  hass.states[MENTIONS_ENTITY] = state(unavailable ? "unavailable" : 2, {
    friendly_name: "MeshCore Tags",
    supported_features: 4,
  });
  hass.states[SECOND_MENTIONS_ENTITY] = state(0, {
    friendly_name: "MeshCore Mentions Archive",
    supported_features: 4,
  });
  hass.entities[MENTIONS_ENTITY] = {
    entity_id: MENTIONS_ENTITY,
    device_id: null,
    platform: "local_todo",
    name: null,
    icon: null,
    disabled_by: null,
  };
  hass.entities[SECOND_MENTIONS_ENTITY] = {
    ...hass.entities[MENTIONS_ENTITY],
    entity_id: SECOND_MENTIONS_ENTITY,
  };
  hass.connection = createLogbookConnection({ reject });
  hass.serviceCalls = [];
  hass.callService = (...args) => {
    hass.serviceCalls.push(args);
    return callService ? callService(...args) : Promise.resolve();
  };
  return hass;
}

function render(config, hass = createHass()) {
  const card = new MainCard();
  card.setConfig(config);
  card.hass = hass;
  const html = card.shadowRoot.innerHTML;
  return {
    card,
    body: html.slice(html.indexOf("</style>") + "</style>".length),
  };
}

const noTarget = render({});
assert.match(noTarget.body, /Select a MeshCore device/);

const missingTarget = render({ target: { type: "node", id: "Missing Node" } });
assert.match(missingTarget.body, /Missing Node/);
assert.match(missingTarget.body, /was not found/);

const hub = render({ target: { type: "hub", id: "55733c" } });
assert.equal((hub.body.match(/<ha-card/g) ?? []).length, 1);
assert.match(hub.body, /<ha-tile-icon>/);
assert.match(hub.body, /<ha-tile-info>/);
assert.match(hub.body, /Test Hub/);
assert.equal(hub.card.shadowRoot.querySelector("ha-tile-info").primary, "test hub");
assert.match(hub.card.shadowRoot.querySelector("ha-tile-info").secondary, /^Online · 55733c$/);
assert.doesNotMatch(hub.body, /class="node-block/);
assert.doesNotMatch(hub.body, />HUBS</);

const onlineNode = render({ target: { type: "node", id: "Spring Farm" } });
assert.equal((onlineNode.body.match(/<ha-card/g) ?? []).length, 1);
assert.match(onlineNode.body, /Spring Farm/);
assert.match(onlineNode.body, /Online/);
assert.equal(onlineNode.card.shadowRoot.querySelector("ha-tile-info").primary, "Spring Farm");
assert.match(onlineNode.card.shadowRoot.querySelector("ha-tile-info").secondary, /^Online/);
assert.match(onlineNode.body, /class="metrics-grid/);
assert.match(onlineNode.body, />RSSI</);
assert.match(onlineNode.body, />SNR</);
assert.match(onlineNode.body, />Noise Floor</);
const metricsHtml = onlineNode.body.match(/<div class="metrics-grid[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
assert.doesNotMatch(metricsHtml, />Battery</);
assert.equal(
  (onlineNode.body.match(/data-entity="sensor\.meshcore_spring_noise_floor_spring_farm"/g) ?? []).length,
  1,
);
assert.doesNotMatch(onlineNode.body, /Node ID/);
assert.doesNotMatch(onlineNode.body, /<h4>Technical<\/h4>/);
assert.match(onlineNode.body, /class="battery-percentage clickable" data-entity="sensor\.meshcore_spring_battery_percentage_spring_farm"/);
assert.match(onlineNode.body, /class="battery-voltage clickable" data-entity="sensor\.meshcore_spring_bat_spring_farm"/);
assert.doesNotMatch(onlineNode.body, /icon="mdi:memory"/);
assert.ok(
  onlineNode.body.indexOf('class="battery-percentage clickable"')
    < onlineNode.body.indexOf('class="battery-voltage clickable"'),
  "battery percentage is rendered before voltage",
);
const sentChipIndex = onlineNode.body.indexOf('icon="mdi:arrow-up"');
const receivedChipIndex = onlineNode.body.indexOf('icon="mdi:arrow-down"');
const temperatureChipIndex = onlineNode.body.indexOf('icon="mdi:thermometer"');
const uptimeChipIndex = onlineNode.body.indexOf('icon="mdi:timer-outline"');
assert.ok(
  sentChipIndex < receivedChipIndex
    && receivedChipIndex < temperatureChipIndex
    && temperatureChipIndex < uptimeChipIndex,
  "quick chips are ordered sent, received, temperature, uptime",
);
assert.match(onlineNode.body, /aria-label="Uptime 1d 12h"/);
assert.match(onlineNode.body, /data-entity="sensor\.meshcore_spring_tx_queue_len_spring_farm"/);
assert.match(onlineNode.body, /data-entity="sensor\.meshcore_spring_nb_sent_rate_spring_farm"/);
assert.match(onlineNode.body, /data-entity="sensor\.meshcore_spring_out_path_spring_farm"/);
assert.match(onlineNode.body, /data-entity="sensor\.meshcore_spring_sent_direct_spring_farm"/);
assert.match(onlineNode.body, /data-entity="sensor\.meshcore_spring_recv_errors_spring_farm"/);
assert.match(onlineNode.body, /Sent direct\s*<\/span>101/);
assert.match(onlineNode.body, /TX\/min\s*<\/span>12\.5/);
assert.match(onlineNode.body, /TX airtime total\s*<\/span>17\.5 min/);
assert.match(onlineNode.body, /Request failures\s*<\/span>2 requests/);
assert.doesNotMatch(onlineNode.body, />Repeater</);
assert.doesNotMatch(onlineNode.body, />REMOTE NODES</);
assert.deepEqual(onlineNode.card.getGridOptions(), {
  columns: "full",
  rows: "auto",
  min_columns: 6,
  min_rows: 1,
});

const shownFirmwareNode = render({
  target: { type: "node", id: "Spring Farm" },
  show_firmware: true,
});
assert.match(shownFirmwareNode.body, /icon="mdi:memory"/);
assert.match(shownFirmwareNode.body, /aria-label="Firmware v1\.14\.0"/);
assert.match(shownFirmwareNode.body, />v1\.14\.0<\/span>/);

const hiddenQuickStatsNode = render({
  target: { type: "node", id: "Spring Farm" },
  hide_quick_stats: true,
  show_firmware: true,
});
assert.doesNotMatch(hiddenQuickStatsNode.body, /icon="mdi:memory"/);

const unknownFirmwareHass = createHass();
unknownFirmwareHass.devices["node-device"].sw_version = " Unknown ";
const unknownFirmwareNode = render(
  { target: { type: "node", id: "Spring Farm" }, show_firmware: true },
  unknownFirmwareHass
);
assert.doesNotMatch(unknownFirmwareNode.body, /icon="mdi:memory"/);

const refreshedFirmwareHass = createHass();
const refreshedFirmwareNode = render(
  { target: { type: "node", id: "Spring Farm" }, show_firmware: true },
  refreshedFirmwareHass
);
const updatedFirmwareHass = createHass();
updatedFirmwareHass.devices["node-device"].sw_version = " v1.15.0\n<beta> ";
refreshedFirmwareNode.card._lastRender = 0;
refreshedFirmwareNode.card.hass = updatedFirmwareHass;
assert.match(refreshedFirmwareNode.card.shadowRoot.innerHTML, /v1\.15\.0 &lt;beta&gt;/);

const offlineNode = render(
  { target: { type: "node", id: "Spring Farm" }, show_firmware: true },
  createHass(false)
);
assert.match(offlineNode.body, /Offline/);
assert.match(offlineNode.body, /class="device-card offline-node-card"/);
assert.doesNotMatch(offlineNode.body, /class="metrics-grid/);
assert.doesNotMatch(offlineNode.body, /class="quick-chip/);
assert.doesNotMatch(offlineNode.body, /class="node-details/);
assert.doesNotMatch(offlineNode.body, /Noise Floor/);
assert.equal(offlineNode.card.getCardSize(), 1);

const unknownOnlineEntity = "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm";
const unknownNodeHass = createHass();
unknownNodeHass.states[unknownOnlineEntity] = state("unknown");
unknownNodeHass.entities[unknownOnlineEntity] = registryEntry("node-device");
const unknownNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  unknownNodeHass
);
assert.match(unknownNode.body, /Unknown/);
assert.match(unknownNode.body, /class="device-header-row unknown"/);
assert.match(unknownNode.body, /icon="mdi:help"/);
assert.doesNotMatch(unknownNode.body, /icon="mdi:signal-off"/);
assert.doesNotMatch(unknownNode.body, /class="metrics-grid/);
assert.equal(unknownNode.card.getCardSize(), 1);

const missingMetricHass = createHass();
missingMetricHass.states["sensor.meshcore_spring_last_rssi_spring_farm"].state = "unavailable";
const missingMetricNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  missingMetricHass
);
assert.doesNotMatch(missingMetricNode.body, />RSSI</);

const missingNoiseHass = createHass();
missingNoiseHass.states["sensor.meshcore_spring_noise_floor_spring_farm"].state = "unavailable";
const missingNoiseNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  missingNoiseHass
);
assert.doesNotMatch(missingNoiseNode.body, />Noise Floor</);
assert.equal((missingNoiseNode.body.match(/class="node-metric clickable"/g) ?? []).length, 2);

const percentageOnlyHass = createHass();
percentageOnlyHass.states["sensor.meshcore_spring_bat_spring_farm"].state = "unavailable";
percentageOnlyHass.states["sensor.meshcore_spring_battery_voltage_spring_farm"].state = "unavailable";
const percentageOnlyNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  percentageOnlyHass
);
assert.match(percentageOnlyNode.body, /class="battery-percentage clickable"/);
assert.doesNotMatch(percentageOnlyNode.body, /class="battery-voltage clickable"/);
assert.doesNotMatch(percentageOnlyNode.body, /icon="mdi:flash"/);

const voltageOnlyHass = createHass();
voltageOnlyHass.states["sensor.meshcore_spring_battery_percentage_spring_farm"].state = "unavailable";
const voltageOnlyNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  voltageOnlyHass
);
assert.doesNotMatch(voltageOnlyNode.body, /class="battery-block"/);
assert.match(voltageOnlyNode.body, /icon="mdi:flash"/);
assert.match(voltageOnlyNode.body, />4\.21 V<\/span>/);

const missingBatteryHass = createHass();
missingBatteryHass.states["sensor.meshcore_spring_battery_percentage_spring_farm"].state = "unavailable";
missingBatteryHass.states["sensor.meshcore_spring_bat_spring_farm"].state = "unavailable";
missingBatteryHass.states["sensor.meshcore_spring_battery_voltage_spring_farm"].state = "unavailable";
const missingBatteryNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  missingBatteryHass
);
assert.doesNotMatch(missingBatteryNode.body, /class="battery-block"/);
assert.doesNotMatch(missingBatteryNode.body, /icon="mdi:flash"/);

const fixedGridNode = render({
  target: { type: "node", id: "Spring Farm" },
  grid_options: { rows: 4 },
});
assert.match(fixedGridNode.body, /class="device-card grid-rows"/);

const headerEntity = "sensor.meshcore_spring_uptime_spring_farm";
onlineNode.card.shadowRoot.listeners.get("click")({
  target: {
    closest: () => ({ dataset: { entity: headerEntity } }),
  },
});
assert.equal(onlineNode.card.lastEvent?.detail?.entityId, headerEntity);

onlineNode.card.shadowRoot.listeners.get("toggle")({
  target: { tagName: "DETAILS", dataset: { nodeId: "node-device" }, open: true },
});
onlineNode.card.setConfig({ target: { type: "node", id: "Spring Farm" } });
assert.match(onlineNode.card.shadowRoot.innerHTML, /<details class="node-details"[^>]* open>/);
assert.match(onlineNode.card.shadowRoot.innerHTML, /<div class="details-content trim-section">/);

const MainEditor = registry.get("mushroom-meshcore-card-editor");
assert.ok(MainEditor, "main-card editor is registered");
const editor = new MainEditor();
editor.setConfig({
  target: { type: "node", id: "Spring Farm" },
  battery_entity: "sensor.old_battery",
  show_neighbors: false,
  map_provider: "meshmapper",
  map_metro: "smf",
  chip_layout: { top: ["sent"], details: ["received"], hidden: ["firmware"] },
  grid_options: { rows: 4 },
  nodes: { "Spring Farm": { enabled: true } },
});
editor.hass = createHass();
const editorForms = editor.querySelectorAll("ha-form");
const targetForm = editorForms[0];
const settingsForm = editorForms[1];
assert.doesNotMatch(JSON.stringify(settingsForm.schema), /show_firmware/);
assert.equal(editor.querySelectorAll("ha-sortable").length, 3);
settingsForm.listeners.get("value-changed")({
  detail: { value: { ...settingsForm.data, name: "Renamed" } },
});
assert.equal(editor.lastEvent?.detail?.config.name, "Renamed");
targetForm.listeners.get("value-changed")({
  detail: { value: { target: JSON.stringify({ type: "hub", id: "55733c" }) } },
});
const switchedConfig = editor.lastEvent?.detail?.config;
assert.deepEqual(switchedConfig.target, { type: "hub", id: "55733c" });
assert.equal(switchedConfig.battery_entity, undefined);
assert.equal(switchedConfig.show_neighbors, undefined);
assert.equal(switchedConfig.show_firmware, undefined);
assert.equal(switchedConfig.chip_layout, undefined);
assert.equal(switchedConfig.nodes, undefined);
assert.equal(switchedConfig.map_provider, "meshmapper");
assert.equal(switchedConfig.map_metro, "smf");
assert.deepEqual(switchedConfig.grid_options, { rows: 4 });

const actionHass = createHass();
const serviceCalls = [];
actionHass.callService = (...args) => {
  serviceCalls.push(args);
};
const sharedActionNode = render(
  {
    target: { type: "node", id: "Spring Farm" },
    tap_action: { action: "none" },
    hold_action: { action: "perform-action", perform_action: "meshcore.hold" },
    double_tap_action: {
      action: "perform-action",
      perform_action: "meshcore.double",
    },
  },
  actionHass,
);
const headerGestureEvent = {
  target: {
    closest: () => ({ dataset: { entity: headerEntity } }),
  },
};
sharedActionNode.card.shadowRoot.listeners.get("click")(headerGestureEvent);
sharedActionNode.card.shadowRoot.listeners.get("click")(headerGestureEvent);
assert.deepEqual(serviceCalls[0]?.slice(0, 2), ["meshcore", "double"]);
sharedActionNode.card.shadowRoot.listeners.get("pointerdown")(headerGestureEvent);
await wait(525);
sharedActionNode.card.shadowRoot.listeners.get("pointerup")({});
assert.deepEqual(serviceCalls[1]?.slice(0, 2), ["meshcore", "hold"]);

const ChannelCard = registry.get("mushroom-meshcore-channel-card");
assert.ok(ChannelCard, "channel card is registered");

const channelNoEntity = new ChannelCard();
channelNoEntity.setConfig({});
channelNoEntity.hass = createChannelHass();
assert.match(channelNoEntity.shadowRoot.innerHTML, /Select a MeshCore channel entity/);
assert.doesNotMatch(channelNoEntity.shadowRoot.innerHTML, />CHANNELS</);

const invalidChannel = new ChannelCard();
invalidChannel.setConfig({ entity: "binary_sensor.not_a_meshcore_channel" });
invalidChannel.hass = createChannelHass();
assert.match(invalidChannel.shadowRoot.innerHTML, /was not found/);
assert.match(invalidChannel.shadowRoot.innerHTML, /not_a_meshcore_channel/);

const channelHass = createChannelHass();
const channelCard = new ChannelCard();
channelCard.setConfig({ entity: CHANNEL_ENTITY });
channelCard.hass = channelHass;
channelCard.connectedCallback();
assert.equal(channelHass.connection.subscriptions.length, 1);
const initialSubscription = channelHass.connection.subscriptions[0];
assert.equal(initialSubscription.params.type, "logbook/event_stream");
assert.deepEqual(initialSubscription.params.entity_ids, [CHANNEL_ENTITY]);
assert.equal(initialSubscription.options.resubscribe, false);
assert.ok(
  Date.parse(initialSubscription.params.end_time) > Date.now() + 300 * 86400 * 1000,
  "live Logbook subscription has a future end date",
);
assert.match(channelCard.shadowRoot.innerHTML, /Loading channel history/);
assert.match(channelCard.shadowRoot.innerHTML, /<ha-tile-info>/);
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").primary, "Public");
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").secondary, "Active");

const hashtagChannelCard = new ChannelCard();
hashtagChannelCard.setConfig({ entity: SECOND_CHANNEL_ENTITY });
hashtagChannelCard.hass = channelHass;
assert.equal(
  hashtagChannelCard.shadowRoot.querySelector("ha-tile-info").primary,
  "#macarthur",
);
assert.equal(
  hashtagChannelCard.shadowRoot.querySelector("ha-tile-info").secondary,
  "Active",
);

const nowSeconds = Math.floor(Date.now() / 1000);
const initialEvents = [
  {
    when: nowSeconds,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    context_id: "context-a",
    message: "<Public> Alice & <Admin>: First: keep\nsecond <line>",
  },
  {
    when: nowSeconds - 10,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    context_id: "context-b",
    message: "<Public> Bob: Older message",
  },
  {
    when: nowSeconds - 20,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    context_id: "context-c",
    message: "Status without a sender",
  },
  {
    when: nowSeconds - 30,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    state: "Active",
  },
  {
    when: nowSeconds - 40,
    name: "Team Messages",
    entity_id: SECOND_CHANNEL_ENTITY,
    message: "<Team> Wrong: channel",
  },
  {
    when: nowSeconds - 25 * 60 * 60,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    message: "<Public> Expired: old",
  },
];
initialSubscription.callback({ events: [...initialEvents, initialEvents[0]] });
await wait(300);
let channelHtml = channelCard.shadowRoot.innerHTML;
assert.equal((channelHtml.match(/class="message-row"/g) ?? []).length, 3);
assert.match(channelHtml, /<strong class="message-sender">Alice &amp; &lt;Admin&gt;<\/strong>/);
assert.match(channelHtml, /First: keep\nsecond &lt;line&gt;/);
assert.match(
  channelHtml,
  /\.message-body\s*\{[^}]*font-weight: var\(--mushroom-meshcore-secondary-font-weight\)/s,
);
assert.match(channelHtml, /Status without a sender/);
assert.doesNotMatch(channelHtml, /&lt;Public&gt;/);
assert.doesNotMatch(channelHtml, /Wrong: channel|Expired: old/);
assert.ok(
  channelHtml.indexOf("Alice &amp;") < channelHtml.indexOf("Bob"),
  "channel messages are newest first",
);
assert.match(channelHtml, /class="date-header"/);
assert.match(channelHtml, /class="message-time"/);
const expectedLocalTime = new Intl.DateTimeFormat("en", {
  timeZone: "Australia/Sydney",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).format(new Date(nowSeconds * 1000));
const expectedLocalDate = new Intl.DateTimeFormat("en", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(new Date(nowSeconds * 1000));
assert.match(channelHtml, new RegExp(`>${expectedLocalTime}<\\/time>`));
assert.match(channelHtml, new RegExp(`Today · ${expectedLocalDate}`));
assert.match(channelHtml, /role="log" tabindex="0"/);
assert.match(channelHtml, /height: 385px/);
assert.doesNotMatch(channelHtml, />CHANNELS</);
assert.deepEqual(channelCard.getGridOptions(), {
  columns: "full",
  rows: 8,
  min_columns: 6,
  min_rows: 4,
});
assert.equal(channelCard.getCardSize(), 8);

channelCard.shadowRoot.listeners.get("click")({
  target: {
    closest: () => ({ dataset: { entity: CHANNEL_ENTITY } }),
  },
});
assert.equal(channelCard.lastEvent?.detail?.entityId, CHANNEL_ENTITY);

const oldHistoryElement = channelCard.shadowRoot.querySelector(".channel-history");
oldHistoryElement.scrollTop = 80;
const oldHistoryHeight = oldHistoryElement.scrollHeight;
initialSubscription.callback({
  events: [{
    when: nowSeconds + 1,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    context_id: "context-live",
    message: "<Public> Live Sender: Newly arrived",
  }],
});
await wait(300);
const newHistoryElement = channelCard.shadowRoot.querySelector(".channel-history");
assert.equal(
  newHistoryElement.scrollTop,
  80 + (newHistoryElement.scrollHeight - oldHistoryHeight),
  "live messages preserve the visible scroll anchor",
);
assert.match(channelCard.shadowRoot.innerHTML, /Live Sender/);

await Promise.resolve();
channelHass.connection.emitReady();
assert.equal(channelHass.connection.subscriptions.length, 2);
assert.equal(
  initialSubscription.unsubscribed,
  false,
  "the dead socket handle is dropped instead of unsubscribed on the new connection",
);
const replaySubscription = channelHass.connection.subscriptions[1];
replaySubscription.callback({ events: initialEvents.slice(0, 3) });
await wait(300);
channelHtml = channelCard.shadowRoot.innerHTML;
assert.equal(
  (channelHtml.match(/class="message-row"/g) ?? []).length,
  4,
  "replayed history is deduplicated after reconnect",
);

channelHass.states[CHANNEL_ENTITY].state = "unavailable";
channelCard.hass = channelHass;
assert.match(channelCard.shadowRoot.innerHTML, /device-header-row offline/);
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").secondary, "Unavailable");

channelHass.states[CHANNEL_ENTITY].state = "Inactive";
channelCard.hass = channelHass;
assert.match(channelCard.shadowRoot.innerHTML, /device-header-row offline/);
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").secondary, "Inactive");

channelHass.states[CHANNEL_ENTITY].state = "off";
channelCard.hass = channelHass;
assert.match(channelCard.shadowRoot.innerHTML, /device-header-row offline/);
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").secondary, "Inactive");

channelHass.states[CHANNEL_ENTITY].state = "on";
channelCard.hass = channelHass;
assert.match(channelCard.shadowRoot.innerHTML, /device-header-row online/);
assert.equal(channelCard.shadowRoot.querySelector("ha-tile-info").secondary, "Active");

delete channelHass.states[CHANNEL_ENTITY];
channelCard.hass = channelHass;
assert.match(channelCard.shadowRoot.innerHTML, /was not found/);
assert.equal(replaySubscription.unsubscribed, true);
channelCard.disconnectedCallback();

const cappedHass = createChannelHass();
const cappedCard = new ChannelCard();
cappedCard.setConfig({
  entity: CHANNEL_ENTITY,
  hours_to_show: 0,
  max_messages: 0,
});
cappedCard.hass = cappedHass;
cappedCard.connectedCallback();
const cappedSubscription = cappedHass.connection.subscriptions[0];
const startAgeHours =
  (Date.now() - Date.parse(cappedSubscription.params.start_time)) / 3_600_000;
assert.ok(startAgeHours > 23.9 && startAgeHours < 24.1);
cappedSubscription.callback({
  events: Array.from({ length: 205 }, (_, index) => ({
    when: nowSeconds - index,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    context_id: `bulk-${index}`,
    message: `<Public> Sender ${index}: Bulk ${index}`,
  })),
});
await wait(300);
const cappedHtml = cappedCard.shadowRoot.innerHTML;
assert.equal((cappedHtml.match(/class="message-row"/g) ?? []).length, 200);
assert.match(cappedHtml, /Bulk 0/);
assert.doesNotMatch(cappedHtml, /Bulk 204/);
cappedCard.disconnectedCallback();

const hiddenHass = createChannelHass();
const hiddenCard = new ChannelCard();
const preservedChannelConfig = {
  entity: CHANNEL_ENTITY,
  name: "Operations",
  icon: "mdi:radio-handheld",
  icon_color: "green",
  hide_timestamps: true,
  hide_date_headers: true,
  hours_to_show: 12,
  max_messages: 50,
  grid_options: { columns: "full", rows: 8 },
};
hiddenCard.setConfig(preservedChannelConfig);
hiddenCard.hass = hiddenHass;
hiddenCard.connectedCallback();
const oldHiddenSubscription = hiddenHass.connection.subscriptions[0];
oldHiddenSubscription.callback({
  events: [{
    when: nowSeconds,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    message: "<Public> Hidden: controls",
  }],
});
await wait(300);
let hiddenHtml = hiddenCard.shadowRoot.innerHTML;
assert.equal(hiddenCard.shadowRoot.querySelector("ha-tile-info").primary, "Operations");
assert.doesNotMatch(hiddenHtml, /class="date-header"/);
assert.doesNotMatch(hiddenHtml, /class="message-time"/);
assert.match(hiddenHtml, /channel-chat-card grid-rows/);

hiddenCard.setConfig({
  ...preservedChannelConfig,
  entity: SECOND_CHANNEL_ENTITY,
});
assert.equal(oldHiddenSubscription.unsubscribed, true);
assert.equal(hiddenHass.connection.subscriptions.length, 2);
oldHiddenSubscription.callback({
  events: [{
    when: nowSeconds + 1,
    name: "Public Messages",
    entity_id: CHANNEL_ENTITY,
    message: "<Public> Stale: ignored",
  }],
});
hiddenHass.connection.subscriptions[1].callback({
  events: [{
    when: nowSeconds + 1,
    name: "Team Messages",
    entity_id: SECOND_CHANNEL_ENTITY,
    message: "<Team> New Sender: Team history",
  }],
});
await wait(300);
hiddenHtml = hiddenCard.shadowRoot.innerHTML;
assert.match(hiddenHtml, /New Sender/);
assert.match(hiddenHtml, /Team history/);
assert.doesNotMatch(hiddenHtml, /Stale: ignored|Hidden: controls/);
hiddenCard.disconnectedCallback();

const emptyHass = createChannelHass();
const emptyCard = new ChannelCard();
emptyCard.setConfig({ entity: CHANNEL_ENTITY });
emptyCard.hass = emptyHass;
emptyCard.connectedCallback();
emptyHass.connection.subscriptions[0].callback({ events: [] });
await wait(300);
assert.match(emptyCard.shadowRoot.innerHTML, /No channel messages in the last 24 hours/);
emptyCard.disconnectedCallback();

const errorHass = createChannelHass({ reject: true });
const errorCard = new ChannelCard();
errorCard.setConfig({ entity: CHANNEL_ENTITY });
errorCard.hass = errorHass;
errorCard.connectedCallback();
await Promise.resolve();
await Promise.resolve();
assert.match(errorCard.shadowRoot.innerHTML, /Channel history is unavailable/);
errorCard.disconnectedCallback();

const ChannelEditor = registry.get("mushroom-meshcore-channel-card-editor");
assert.ok(ChannelEditor, "channel-card editor is registered");
const channelEditor = new ChannelEditor();
channelEditor.setConfig(preservedChannelConfig);
channelEditor.hass = createChannelHass();
const channelForms = channelEditor.querySelectorAll("ha-form");
assert.equal(channelForms.length, 2);
assert.deepEqual(
  channelForms[0].schema[0].selector.entity.include_entities,
  [CHANNEL_ENTITY, SECOND_CHANNEL_ENTITY],
);
assert.deepEqual(
  channelForms[1].schema.map((section) => section.title),
  ["Appearance", "Interactions", "History"],
);
channelForms[0].listeners.get("value-changed")({
  detail: { value: { entity: SECOND_CHANNEL_ENTITY } },
});
const switchedChannelConfig = channelEditor.lastEvent?.detail?.config;
assert.equal(switchedChannelConfig.entity, SECOND_CHANNEL_ENTITY);
assert.equal(switchedChannelConfig.name, "Operations");
assert.equal(switchedChannelConfig.icon, "mdi:radio-handheld");
assert.equal(switchedChannelConfig.hide_timestamps, true);
assert.equal(switchedChannelConfig.hours_to_show, 12);
assert.equal(switchedChannelConfig.max_messages, 50);
assert.deepEqual(switchedChannelConfig.grid_options, { columns: "full", rows: 8 });
const stableSettingsForm = channelEditor.querySelectorAll("ha-form")[1];
channelEditor.setConfig(switchedChannelConfig);
assert.equal(
  channelEditor.querySelectorAll("ha-form")[1],
  stableSettingsForm,
  "config echo preserves editor panels and focus",
);

const noChannelsEditor = new ChannelEditor();
noChannelsEditor.setConfig({});
noChannelsEditor.hass = createHass();
assert.equal(noChannelsEditor.querySelectorAll("ha-alert").length, 1);
assert.match(
  noChannelsEditor.querySelectorAll("ha-alert")[0].textContent,
  /No MeshCore channel entities detected/,
);

const MentionsCard = registry.get("mushroom-meshcore-mentions-card");
assert.ok(MentionsCard, "mentions card is registered");
assert.ok(
  window.customCards.some((card) => card.type === "mushroom-meshcore-mentions-card"),
  "mentions card is registered in the card picker",
);
assert.deepEqual(MentionsCard.getStubConfig(), {});

const mentionsNoEntity = new MentionsCard();
mentionsNoEntity.setConfig({});
mentionsNoEntity.hass = createMentionsHass();
assert.match(mentionsNoEntity.shadowRoot.innerHTML, /Select the Home Assistant to-do list/);

const mentionsWrongDomain = new MentionsCard();
mentionsWrongDomain.setConfig({ entity: "sensor.meshcore_tags" });
mentionsWrongDomain.hass = createMentionsHass();
assert.match(mentionsWrongDomain.shadowRoot.innerHTML, /is not a to-do entity/);

const mentionsMissing = new MentionsCard();
mentionsMissing.setConfig({ entity: "todo.missing_mentions" });
mentionsMissing.hass = createMentionsHass();
assert.match(mentionsMissing.shadowRoot.innerHTML, /was not found/);

const mentionsUnavailableHass = createMentionsHass({ unavailable: true });
const mentionsUnavailable = new MentionsCard();
mentionsUnavailable.setConfig({ entity: MENTIONS_ENTITY });
mentionsUnavailable.hass = mentionsUnavailableHass;
mentionsUnavailable.connectedCallback();
assert.match(mentionsUnavailable.shadowRoot.innerHTML, /selected mentions list is unavailable/);
assert.equal(mentionsUnavailableHass.connection.subscriptions.length, 0);
mentionsUnavailable.disconnectedCallback();

const mentionsHass = createMentionsHass();
const mentionsCard = new MentionsCard();
mentionsCard.setConfig({ entity: MENTIONS_ENTITY });
mentionsCard.hass = mentionsHass;
mentionsCard.connectedCallback();
assert.equal(mentionsHass.connection.subscriptions.length, 1);
const mentionsSubscription = mentionsHass.connection.subscriptions[0];
assert.deepEqual(mentionsSubscription.params, {
  type: "todo/item/subscribe",
  entity_id: MENTIONS_ENTITY,
});
assert.equal(mentionsSubscription.options.resubscribe, false);
assert.match(mentionsCard.shadowRoot.innerHTML, /Loading MeshCore mentions/);
assert.equal(mentionsCard.shadowRoot.querySelector("ha-tile-info").primary, "Mentions");
assert.equal(mentionsCard.shadowRoot.querySelector("ha-tile-info").secondary, "Loading…");

const mentionItems = [
  {
    uid: "mention-a",
    summary: "Alice & <Admin> on Public: First: keep\nsecond <line>",
    status: "needs_action",
    description: "Details <unsafe>",
  },
  {
    uid: "mention-b",
    summary: "Bob on Team: Handled <message>",
    status: "completed",
  },
  {
    uid: "mention-c",
    summary: "<script>alert('fallback')</script>",
    status: null,
  },
  {
    uid: "mention-d",
    summary: "Rock on Radio on Ops: Hello",
    status: "needs_action",
  },
  { uid: 5, summary: "Invalid item", status: "needs_action" },
];
mentionsSubscription.callback({ items: mentionItems });
let mentionsHtml = mentionsCard.shadowRoot.innerHTML;
assert.equal((mentionsHtml.match(/class="mention-row/g) ?? []).length, 3);
assert.match(mentionsHtml, /Alice &amp; &lt;Admin&gt;/);
assert.match(mentionsHtml, /on Public/);
assert.match(mentionsHtml, /First: keep\nsecond &lt;line&gt;/);
assert.match(mentionsHtml, /Details &lt;unsafe&gt;/);
assert.match(
  mentionsHtml,
  /&lt;script&gt;alert\(&#39;fallback&#39;\)&lt;\/script&gt;/,
);
assert.doesNotMatch(mentionsHtml, /<script>/);
assert.match(mentionsHtml, /Rock on Radio/);
assert.match(mentionsHtml, /on Ops/);
assert.doesNotMatch(mentionsHtml, /Handled &lt;message&gt;|class="mention-section-label"/);
assert.equal(mentionsCard.shadowRoot.querySelector("ha-tile-info").secondary, "3 unhandled mentions");
assert.deepEqual(mentionsCard.getGridOptions(), {
  columns: "full",
  rows: "auto",
  min_columns: 6,
  min_rows: 1,
});
assert.equal(mentionsCard.getCardSize(), 4);

mentionsCard.setConfig({
  entity: MENTIONS_ENTITY,
  name: "Radio Mentions",
  icon: "mdi:message-alert",
  icon_color: "orange",
  hide_completed: false,
  grid_options: { columns: "full", rows: 6 },
});
mentionsHtml = mentionsCard.shadowRoot.innerHTML;
assert.equal(mentionsCard.shadowRoot.querySelector("ha-tile-info").primary, "Radio Mentions");
assert.match(mentionsHtml, /mdi:message-alert/);
assert.match(mentionsHtml, /--mushroom-meshcore-icon-override-color:var\(--orange-color/);
assert.equal((mentionsHtml.match(/class="mention-row/g) ?? []).length, 4);
assert.match(mentionsHtml, />Pending</);
assert.match(mentionsHtml, />Handled</);
assert.match(mentionsHtml, /Handled &lt;message&gt;/);
assert.match(mentionsHtml, /mentions-card grid-rows/);

mentionsCard.shadowRoot.listeners.get("click")({
  target: {
    closest: (selector) =>
      selector === "[data-mention-uid]"
        ? { dataset: { mentionUid: "mention-a" } }
        : null,
  },
});
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(mentionsHass.serviceCalls[0], [
  "todo",
  "update_item",
  { item: "mention-a", status: "completed" },
  { entity_id: MENTIONS_ENTITY },
]);
assert.match(
  mentionsCard.shadowRoot.innerHTML,
  /data-mention-uid="mention-a"[\s\S]*?aria-checked="true"/,
);

mentionsCard.shadowRoot.listeners.get("click")({
  target: {
    closest: (selector) =>
      selector === "[data-mention-uid]"
        ? { dataset: { mentionUid: "mention-b" } }
        : null,
  },
});
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(mentionsHass.serviceCalls[1]?.slice(0, 3), [
  "todo",
  "update_item",
  { item: "mention-b", status: "needs_action" },
]);

mentionsCard.shadowRoot.listeners.get("click")({
  target: {
    closest: (selector) =>
      selector === "[data-action-scope]"
        ? { dataset: { entity: MENTIONS_ENTITY } }
        : null,
  },
});
assert.equal(mentionsCard.lastEvent?.detail?.entityId, MENTIONS_ENTITY);

let releasePending;
const pendingService = new Promise((resolve) => {
  releasePending = resolve;
});
const pendingMentionsHass = createMentionsHass({ callService: () => pendingService });
const pendingMentionsCard = new MentionsCard();
pendingMentionsCard.setConfig({ entity: MENTIONS_ENTITY });
pendingMentionsCard.hass = pendingMentionsHass;
pendingMentionsCard.connectedCallback();
pendingMentionsHass.connection.subscriptions[0].callback({ items: [mentionItems[0]] });
const pendingClick = {
  target: {
    closest: (selector) =>
      selector === "[data-mention-uid]"
        ? { dataset: { mentionUid: "mention-a" } }
        : null,
  },
};
pendingMentionsCard.shadowRoot.listeners.get("click")(pendingClick);
pendingMentionsCard.shadowRoot.listeners.get("click")(pendingClick);
assert.equal(pendingMentionsHass.serviceCalls.length, 1, "pending item suppresses duplicate updates");
assert.match(pendingMentionsCard.shadowRoot.innerHTML, /disabled aria-busy="true"/);
releasePending();
await Promise.resolve();
await Promise.resolve();
pendingMentionsCard.disconnectedCallback();

const rejectedMentionsHass = createMentionsHass({
  callService: () => Promise.reject(new Error("Update rejected")),
});
const rejectedMentionsCard = new MentionsCard();
rejectedMentionsCard.setConfig({ entity: MENTIONS_ENTITY });
rejectedMentionsCard.hass = rejectedMentionsHass;
rejectedMentionsCard.connectedCallback();
rejectedMentionsHass.connection.subscriptions[0].callback({ items: [mentionItems[0]] });
rejectedMentionsCard.shadowRoot.listeners.get("click")(pendingClick);
await Promise.resolve();
await Promise.resolve();
assert.match(rejectedMentionsCard.shadowRoot.innerHTML, /Could not update this mention/);
assert.match(rejectedMentionsCard.shadowRoot.innerHTML, /aria-checked="false"/);
rejectedMentionsCard.disconnectedCallback();

const emptyMentionsHass = createMentionsHass();
const emptyMentionsCard = new MentionsCard();
emptyMentionsCard.setConfig({ entity: MENTIONS_ENTITY });
emptyMentionsCard.hass = emptyMentionsHass;
emptyMentionsCard.connectedCallback();
emptyMentionsHass.connection.subscriptions[0].callback({ items: [] });
assert.match(emptyMentionsCard.shadowRoot.innerHTML, /No unhandled MeshCore mentions/);
assert.equal(emptyMentionsCard.shadowRoot.querySelector("ha-tile-info").secondary, "0 unhandled mentions");
emptyMentionsCard.disconnectedCallback();

const mentionsErrorHass = createMentionsHass({ reject: true });
const mentionsErrorCard = new MentionsCard();
mentionsErrorCard.setConfig({ entity: MENTIONS_ENTITY });
mentionsErrorCard.hass = mentionsErrorHass;
mentionsErrorCard.connectedCallback();
await Promise.resolve();
await Promise.resolve();
assert.match(mentionsErrorCard.shadowRoot.innerHTML, /Mentions are unavailable/);
mentionsErrorCard.disconnectedCallback();

await Promise.resolve();
mentionsHass.connection.emitReady();
assert.equal(mentionsHass.connection.subscriptions.length, 2);
assert.equal(
  mentionsSubscription.unsubscribed,
  false,
  "the dead mentions subscription handle is dropped on reconnect",
);
const replayMentionsSubscription = mentionsHass.connection.subscriptions[1];
replayMentionsSubscription.callback({ items: mentionItems.slice(0, 2) });
await Promise.resolve();
mentionsCard.setConfig({ entity: SECOND_MENTIONS_ENTITY });
assert.equal(replayMentionsSubscription.unsubscribed, true);
assert.equal(mentionsHass.connection.subscriptions.length, 3);
const switchedMentionsSubscription = mentionsHass.connection.subscriptions[2];
mentionsCard.disconnectedCallback();
await Promise.resolve();
assert.equal(switchedMentionsSubscription.unsubscribed, true);

const MentionsEditor = registry.get("mushroom-meshcore-mentions-card-editor");
assert.ok(MentionsEditor, "mentions-card editor is registered");
const mentionsEditorConfig = {
  entity: MENTIONS_ENTITY,
  name: "Radio Mentions",
  icon: "mdi:message-alert",
  icon_color: "orange",
  hide_completed: false,
  tap_action: { action: "more-info" },
  grid_options: { columns: "full", rows: 6 },
};
const mentionsEditor = new MentionsEditor();
mentionsEditor.setConfig(mentionsEditorConfig);
mentionsEditor.hass = createMentionsHass();
let mentionsForms = mentionsEditor.querySelectorAll("ha-form");
assert.equal(mentionsForms.length, 2);
assert.equal(mentionsForms[0].schema[0].selector.entity.domain, "todo");
assert.deepEqual(mentionsForms[0].schema[0].selector.entity.include_entities, [
  SECOND_MENTIONS_ENTITY,
  MENTIONS_ENTITY,
]);
assert.deepEqual(
  mentionsForms[1].schema.map((section) => section.title),
  ["Appearance", "Interactions", "Mentions"],
);
assert.equal(mentionsForms[1].data.hide_completed, false);
mentionsForms[0].listeners.get("value-changed")({
  detail: { value: { entity: SECOND_MENTIONS_ENTITY } },
});
const switchedMentionsConfig = mentionsEditor.lastEvent?.detail?.config;
assert.equal(switchedMentionsConfig.entity, SECOND_MENTIONS_ENTITY);
assert.equal(switchedMentionsConfig.name, "Radio Mentions");
assert.equal(switchedMentionsConfig.hide_completed, false);
assert.deepEqual(switchedMentionsConfig.grid_options, { columns: "full", rows: 6 });
mentionsForms = mentionsEditor.querySelectorAll("ha-form");
const stableMentionsSettings = mentionsForms[1];
mentionsEditor.setConfig(switchedMentionsConfig);
assert.equal(
  mentionsEditor.querySelectorAll("ha-form")[1],
  stableMentionsSettings,
  "mentions config echo preserves editor panels and focus",
);
stableMentionsSettings.listeners.get("value-changed")({
  detail: {
    value: {
      ...stableMentionsSettings.data,
      hide_completed: true,
    },
  },
});
const behaviorMentionsConfig = mentionsEditor.lastEvent?.detail?.config;
assert.equal("hide_completed" in behaviorMentionsConfig, false);
assert.deepEqual(behaviorMentionsConfig.grid_options, { columns: "full", rows: 6 });

const noTodoEditor = new MentionsEditor();
noTodoEditor.setConfig({});
noTodoEditor.hass = createHass();
assert.equal(noTodoEditor.querySelectorAll("ha-alert").length, 1);
assert.match(
  noTodoEditor.querySelectorAll("ha-alert")[0].textContent,
  /No Home Assistant to-do lists detected/,
);

console.log("Main, channel, and mentions render smoke tests passed");
