import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class FakeShadowRoot {
  _innerHTML = "";
  tileInfos = [];
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
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  querySelector(selector) {
    return selector === "ha-tile-info" ? this.tileInfos[0] ?? null : null;
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
    [`${prefix}battery_voltage${suffix}`]: state(4.08),
    [`${prefix}nb_sent${suffix}`]: state(19175),
    [`${prefix}nb_recv${suffix}`]: state(64487),
    [`${prefix}temperature${suffix}`]: state(25),
    [`${prefix}last_advert${suffix}`]: state(Math.floor(Date.now() / 1000) - 30),
    [`${prefix}airtime_utilization${suffix}`]: state(2.5),
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
        via_device_id: "hub-device",
      },
    },
    themes: {},
    language: "en",
    locale: { language: "en" },
  };
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
assert.match(onlineNode.body, /class="battery-voltage clickable" data-entity="sensor\.meshcore_spring_battery_voltage_spring_farm"/);
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
assert.doesNotMatch(onlineNode.body, />Repeater</);
assert.doesNotMatch(onlineNode.body, />REMOTE NODES</);
assert.deepEqual(onlineNode.card.getGridOptions(), {
  columns: "full",
  rows: "auto",
  min_columns: 6,
  min_rows: 1,
});

const offlineNode = render(
  { target: { type: "node", id: "Spring Farm" } },
  createHass(false)
);
assert.match(offlineNode.body, /Offline/);
assert.match(offlineNode.body, /class="device-card offline-node-card"/);
assert.doesNotMatch(offlineNode.body, /class="metrics-grid/);
assert.doesNotMatch(offlineNode.body, /class="quick-chip/);
assert.doesNotMatch(offlineNode.body, /class="node-details/);
assert.doesNotMatch(offlineNode.body, /Noise Floor/);
assert.equal(offlineNode.card.getCardSize(), 1);

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
assert.match(voltageOnlyNode.body, />4\.08 V<\/span>/);

const missingBatteryHass = createHass();
missingBatteryHass.states["sensor.meshcore_spring_battery_percentage_spring_farm"].state = "unavailable";
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
  grid_options: { rows: 4 },
  nodes: { "Spring Farm": { enabled: true } },
});
editor.hass = createHass();
const targetForm = editor.querySelectorAll("ha-form")[0];
targetForm.listeners.get("value-changed")({
  detail: { value: { target: JSON.stringify({ type: "hub", id: "55733c" }) } },
});
const switchedConfig = editor.lastEvent?.detail?.config;
assert.deepEqual(switchedConfig.target, { type: "hub", id: "55733c" });
assert.equal(switchedConfig.battery_entity, undefined);
assert.equal(switchedConfig.show_neighbors, undefined);
assert.equal(switchedConfig.nodes, undefined);
assert.equal(switchedConfig.map_provider, "meshmapper");
assert.equal(switchedConfig.map_metro, "smf");
assert.deepEqual(switchedConfig.grid_options, { rows: 4 });

console.log("Main-card render smoke tests passed");
