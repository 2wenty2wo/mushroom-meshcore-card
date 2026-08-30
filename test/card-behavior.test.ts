// Interactive and stateful behavior of the device card: delegated pointer
// handling, refresh timers, hub/node detail sections, and the neighbors list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HassEntity } from "home-assistant-js-websocket";
import { MeshcoreCard } from "../src/card.js";
import { makeLocalize } from "../src/localize.js";
import { renderNeighborSection } from "../src/neighbors.js";
import type { HomeAssistant, MeshcoreCardConfig } from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_ONLINE_ENTITY,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  defineOnce,
  registryEntry,
  shadowBody,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);

const t = makeLocalize("en");

const NODE_TARGET = { target: { type: "node", id: NODE_NAME } };
const HUB_TARGET = { target: { type: "hub", id: HUB_PUBKEY } };

const nodeEntity = (metric: string): string =>
  `${NODE_PREFIX}${metric}${NODE_SUFFIX}`;
const hubEntity = (metric: string): string =>
  `sensor.meshcore_${HUB_PUBKEY}_${metric}_test_hub`;

function addEntity(
  hass: HomeAssistant,
  entityId: string,
  entityState: HassEntity,
  deviceId: string | null = NODE_DEVICE_ID,
  platform = "meshcore"
): void {
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
  const entry = registryEntry(deviceId, platform);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
}

function addRegistryEntity(
  hass: HomeAssistant,
  entityId: string,
  deviceId: string | null = NODE_DEVICE_ID
): void {
  const entry = registryEntry(deviceId);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
}

function removeEntity(hass: HomeAssistant, entityId: string): void {
  delete hass.states[entityId];
  delete hass.entities[entityId];
}

function renderCard(
  config: unknown,
  hass: HomeAssistant = createHass()
): { card: MeshcoreCard; body: string } {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config as MeshcoreCardConfig);
  card.hass = hass;
  return { card, body: shadowBody(card) };
}

function dispatch(target: Element, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

interface ShowDialogDetail {
  dialogTag: string;
  dialogImport: () => Promise<unknown>;
  dialogParams: Record<string, unknown>;
}

interface TestDialogElement extends HTMLElement {
  params: Record<string, unknown>;
  showDialog(params: Record<string, unknown>): void;
  closeDialog(): boolean;
}

function clickForDialog(card: MeshcoreCard, trigger: Element): ShowDialogDetail {
  let detail: ShowDialogDetail | undefined;
  card.addEventListener("show-dialog", (event) => {
    detail = (event as CustomEvent<ShowDialogDetail>).detail;
  }, { once: true });
  dispatch(trigger, "click");
  expect(detail).toBeDefined();
  return detail!;
}

async function instantiateDialog(
  detail: ShowDialogDetail
): Promise<TestDialogElement> {
  await detail.dialogImport();
  expect(detail.dialogTag).toBe("mushroom-meshcore-neighbors-dialog");
  expect(customElements.get(detail.dialogTag)).toBeDefined();
  const dialog = document.createElement(detail.dialogTag) as TestDialogElement;
  dialog.params = detail.dialogParams;
  document.body.appendChild(dialog);
  return dialog;
}

describe("device card interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("opens more-info when a metric backed by an entity is clicked", () => {
    const { card } = renderCard(NODE_TARGET);
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as Event & { detail: { entityId: string } }).detail.entityId
      );
    });
    const metric = card.shadowRoot!.querySelector(
      `.node-metric[data-entity="${nodeEntity("last_rssi")}"]`
    )!;
    dispatch(metric, "click");
    expect(seen).toEqual([nodeEntity("last_rssi")]);
  });

  it("opens more-info on the primary entity from a header tap", () => {
    const { card } = renderCard(NODE_TARGET);
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as Event & { detail: { entityId: string } }).detail.entityId
      );
    });
    dispatch(card.shadowRoot!.querySelector("[data-action-scope]")!, "click");
    expect(seen).toEqual([nodeEntity("uptime")]);
  });

  it("prefers the enabled online entity for header more-info", () => {
    const hass = createHass();
    addEntity(
      hass,
      "binary_sensor.meshcore_spring_contact",
      state("fresh", { adv_name: NODE_NAME })
    );
    addEntity(hass, NODE_ONLINE_ENTITY, state("on"));
    const { card } = renderCard(NODE_TARGET, hass);
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as Event & { detail: { entityId: string } }).detail.entityId
      );
    });
    dispatch(card.shadowRoot!.querySelector("[data-action-scope]")!, "click");
    expect(seen).toEqual([NODE_ONLINE_ENTITY]);
  });

  it("fires a configured hold action and suppresses the trailing click", () => {
    const hass = createHass();
    const callService = vi.fn();
    hass.callService = callService;
    const { card } = renderCard(
      {
        ...NODE_TARGET,
        hold_action: { action: "perform-action", perform_action: "test.hold" },
      },
      hass
    );
    const listener = vi.fn();
    card.addEventListener("hass-more-info", listener);
    const header = card.shadowRoot!.querySelector("[data-action-scope]")!;
    dispatch(header, "pointerdown");
    vi.advanceTimersByTime(500);
    expect(callService).toHaveBeenCalledWith("test", "hold", undefined, undefined);
    dispatch(header, "pointerup");
    dispatch(header, "click");
    expect(listener).not.toHaveBeenCalled();
  });

  it("remembers a details toggle across re-renders", () => {
    const { card } = renderCard(NODE_TARGET);
    const details = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      "details.node-details"
    )!;
    expect(details.open).toBe(false);
    details.open = true;
    dispatch(details, "toggle");
    card.setConfig(NODE_TARGET as MeshcoreCardConfig);
    expect(card.shadowRoot!.querySelector("details[open]")).not.toBeNull();

    const reopened = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      "details.node-details"
    )!;
    reopened.open = false;
    dispatch(reopened, "toggle");
    card.setConfig(NODE_TARGET as MeshcoreCardConfig);
    expect(card.shadowRoot!.querySelector("details[open]")).toBeNull();
  });

  it("forgets open details when the target changes", () => {
    const { card } = renderCard(NODE_TARGET);
    const details = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      "details.node-details"
    )!;
    details.open = true;
    dispatch(details, "toggle");
    card.setConfig(HUB_TARGET as MeshcoreCardConfig);
    card.setConfig(NODE_TARGET as MeshcoreCardConfig);
    expect(card.shadowRoot!.querySelector("details[open]")).toBeNull();
  });

  it("opens details on first render when details_default_open is set", () => {
    const { card } = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
    });
    expect(card.shadowRoot!.querySelector("details[open]")).not.toBeNull();
    // Re-seeding only happens when the option itself changes.
    card.setConfig({
      ...NODE_TARGET,
      details_default_open: true,
    } as MeshcoreCardConfig);
    expect(card.shadowRoot!.querySelector("details[open]")).not.toBeNull();
  });
});

describe("device card refresh timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("re-renders on the minute tick while connected", () => {
    const hass = createHass();
    const { card } = renderCard(NODE_TARGET, hass);
    document.body.appendChild(card);
    expect(shadowBody(card)).toContain(">Online");
    hass.states[nodeEntity("uptime")] = state("unavailable");
    vi.advanceTimersByTime(60_000);
    expect(shadowBody(card)).toContain("Offline");
  });

  it("stops ticking and pending renders once disconnected", () => {
    const hass = createHass();
    const { card } = renderCard(NODE_TARGET, hass);
    document.body.appendChild(card);
    card.hass = createHass({ online: false }); // schedules a throttled render
    card.remove();
    hass.states[nodeEntity("uptime")] = state("unavailable");
    vi.advanceTimersByTime(120_000);
    expect(shadowBody(card)).toContain(">Online");
  });

  it("throttles authoritative state changes and renders the latest state", () => {
    const onlineHass = createHass();
    addEntity(onlineHass, NODE_ONLINE_ENTITY, state("on"));
    const { card } = renderCard(NODE_TARGET, onlineHass);
    expect(shadowBody(card)).toContain(">Online");
    const offlineHass = createHass();
    addEntity(offlineHass, NODE_ONLINE_ENTITY, state("off"));
    card.hass = offlineHass;
    const unknownHass = createHass();
    addEntity(unknownHass, NODE_ONLINE_ENTITY, state("unknown"));
    // Two quick updates share one deferred render slot; the latest wins.
    card.hass = unknownHass;
    expect(shadowBody(card)).toContain(">Online");
    vi.advanceTimersByTime(10_000);
    expect(shadowBody(card)).toContain(">Unknown");
    expect(shadowBody(card)).toContain('icon="mdi:help"');
  });

  it("re-renders when only the online registry enabled state changes", () => {
    const hass = createHass();
    addRegistryEntity(hass, NODE_ONLINE_ENTITY);
    const { card } = renderCard(NODE_TARGET, hass);
    expect(shadowBody(card)).toContain(">Unknown");
    hass.entities[NODE_ONLINE_ENTITY]!.disabled_by = "user";
    card.hass = hass;
    expect(shadowBody(card)).toContain(">Unknown");
    vi.advanceTimersByTime(10_000);
    expect(shadowBody(card)).toContain(">Online");
  });
});

describe("hub rendering details", () => {
  function enrichedHubHass(): HomeAssistant {
    const hass = createHass();
    const hub = (metric: string, entityState: HassEntity): void =>
      addEntity(hass, hubEntity(metric), entityState, HUB_DEVICE_ID);
    hub("frequency", state(915.125));
    hub("bandwidth", state(250));
    hub("spreading_factor", state(10));
    hub("tx_power", state(22));
    hub("latitude", state(-34.92866));
    hub("longitude", state(138.59863));
    hub("ch1_voltage", state(3.7));
    hub("request_rate_limiter", state(10));
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_mqtt_broker`,
      state("connected", { server: "mqtt.example" }),
      HUB_DEVICE_ID
    );
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_mqtt_backup`,
      state("", { friendly_name: "MeshCore backup_link" }),
      HUB_DEVICE_ID
    );
    return hass;
  }

  it("renders technical, MQTT, location, and other sections in details", () => {
    const { body } = renderCard(
      { ...HUB_TARGET, details_default_open: true },
      enrichedHubHass()
    );
    expect(body).toContain("915.125 MHz");
    expect(body).toContain("250 kHz");
    expect(body).toContain("SF10");
    expect(body).toContain("22 dBm");
    expect(body).toContain("mqtt-ok");
    expect(body).toContain("mqtt.example");
    expect(body).toContain("mqtt-err");
    expect(body).toContain("3.7 V");
    expect(body).toContain("10 tok");
    expect(body).toContain("-34.92866, 138.59863");
    // innerHTML serialization escapes & in the href.
    expect(body).toContain("https://analyzer.letsmesh.net/map?lat=-34.92866");
    expect(body).toContain("long=138.59863");
  });

  it("renders hub chips in both custom destinations", () => {
    const hass = enrichedHubHass();
    const { body } = renderCard({
      ...HUB_TARGET,
      details_default_open: true,
      chip_layout: {
        top: ["spreading_factor", "frequency"],
        details: ["hardware", "firmware"],
        hidden: [],
      },
    }, hass);
    const quickRow = body.match(/<div class="quick-chip-row[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const detailRow = body.match(/<div class="detail-chips">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(quickRow).toContain("SF10");
    expect(quickRow).toContain("915.125 MHz");
    expect(detailRow).toContain("Hardware");
    expect(detailRow).toContain("Test Hub");
    expect(detailRow).toContain("Firmware");
    expect(detailRow).toContain("1.0");

    const sfDetails = renderCard({
      ...HUB_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["spreading_factor"], hidden: [] },
    }, hass).body;
    expect(sfDetails.match(/<div class="detail-chips">([\s\S]*?)<\/div>/)?.[1]).toContain("SF10");
  });

  it("omits a static detail chip when its hub metadata is absent", () => {
    const hass = createHass();
    hass.states[hubEntity("node_status")]!.attributes = {};
    const { body } = renderCard({
      ...HUB_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["hardware"], hidden: [] },
    }, hass);
    expect(body).not.toContain('<span class="chip-label">Hardware ');
  });

  it("links to a MeshMapper metro when configured", () => {
    const { body } = renderCard(
      {
        ...HUB_TARGET,
        details_default_open: true,
        map_provider: "meshmapper",
        map_metro: "smf",
      },
      enrichedHubHass()
    );
    expect(body).toContain("https://smf.meshmapper.net/?lat=-34.92866");
  });

  it("hides the quick stats row on request", () => {
    const visible = renderCard(HUB_TARGET).body;
    expect(visible).toContain("static-chip");
    const { body } = renderCard({ ...HUB_TARGET, hide_quick_stats: true });
    expect(body).not.toContain("static-chip");
  });

  it("strips an unspaced MeshCore prefix and omits an unknown node count", () => {
    const hass = createHass({
      extraStates: {
        "sensor.meshcore_ab12cd_node_count_meshcorehub": state("unknown"),
      },
    });
    const { body } = renderCard({ target: { type: "hub", id: "ab12cd" } }, hass);
    expect(body).toContain('<span slot="primary">hub</span>');
    expect(body).not.toContain("count-badge");
    expect(body).toContain(`Offline · ab12cd`);
  });
});

describe("node rendering details", () => {
  it("uses online as authoritative over unhealthy legacy signals", () => {
    const hass = createHass({ online: false });
    addEntity(hass, nodeEntity("request_successes"), state(0));
    addEntity(hass, nodeEntity("status"), state("offline"));
    addEntity(hass, NODE_ONLINE_ENTITY, state("on"));
    const { card, body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
    expect(body).toContain('class="metrics-grid');
    expect(card.getCardSize()).toBe(5);
  });

  it("uses offline as authoritative over healthy legacy signals", () => {
    const hass = createHass();
    addEntity(hass, nodeEntity("request_successes"), state(5));
    addEntity(hass, nodeEntity("status"), state("online"));
    addEntity(hass, NODE_ONLINE_ENTITY, state("off"));
    const { card, body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Offline");
    expect(body).toContain('icon="mdi:signal-off"');
    expect(body).not.toContain('class="metrics-grid');
    expect(body).not.toContain("battery-block");
    expect(card.getCardSize()).toBe(1);
  });

  it.each(["unknown", "unavailable", "", "unexpected"])(
    "preserves the dedicated %s state as unknown",
    (onlineState) => {
      const hass = createHass();
      addEntity(hass, nodeEntity("request_successes"), state(5));
      addEntity(hass, nodeEntity("status"), state("online"));
      addEntity(hass, NODE_ONLINE_ENTITY, state(onlineState));
      const { card, body } = renderCard(
        { ...NODE_TARGET, icon_color: "red" },
        hass
      );
      expect(body).toContain(">Unknown");
      expect(body).toContain('class="device-header-row unknown"');
      expect(body).toContain('icon="mdi:help"');
      expect(body).not.toContain('icon="mdi:signal-off"');
      expect(body).not.toContain("--mushroom-meshcore-icon-override-color");
      expect(body).not.toContain('class="metrics-grid');
      expect(body).not.toContain("battery-block");
      expect(card.getCardSize()).toBe(1);
    }
  );

  it("renders unknown when the enabled online entity has no state", () => {
    const hass = createHass();
    addRegistryEntity(hass, NODE_ONLINE_ENTITY);
    const { card, body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Unknown");
    expect(body).toContain('icon="mdi:help"');
    expect(card.getCardSize()).toBe(1);
  });

  it("uses legacy inference when the online entity is disabled", () => {
    const hass = createHass();
    addEntity(hass, NODE_ONLINE_ENTITY, state("off"));
    hass.entities[NODE_ONLINE_ENTITY]!.disabled_by = "user";
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
    expect(body).toContain(`data-entity="${nodeEntity("uptime")}"`);
    expect(body).not.toContain(`data-entity="${NODE_ONLINE_ENTITY}"`);
  });

  it("ignores an online entity attached to another device", () => {
    const hass = createHass();
    addEntity(hass, NODE_ONLINE_ENTITY, state("off"), "other-device");
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
  });

  it("does not treat a non-binary online sensor as authoritative", () => {
    const hass = createHass();
    addEntity(hass, nodeEntity("online"), state("off"));
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
  });

  it("uses a legacy online sensor when stronger fallback signals are absent", () => {
    const hass = createHass();
    const legacyOnlineId = nodeEntity("online");
    removeEntity(hass, nodeEntity("uptime"));
    addEntity(hass, nodeEntity("status"), state("offline"));
    addEntity(hass, legacyOnlineId, state("online"));
    addEntity(hass, NODE_ONLINE_ENTITY, state("off"));
    hass.entities[NODE_ONLINE_ENTITY]!.disabled_by = "user";

    const { card, body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
    expect(body).toContain('class="metrics-grid');
    expect(body).toContain(`data-entity="${legacyOnlineId}"`);
    expect(body).not.toContain(`data-entity="${NODE_ONLINE_ENTITY}"`);
    expect(card.getCardSize()).toBe(5);
  });

  it("does not treat a non-MeshCore online binary sensor as authoritative", () => {
    const hass = createHass();
    addEntity(
      hass,
      NODE_ONLINE_ENTITY,
      state("off"),
      NODE_DEVICE_ID,
      "template"
    );
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain(">Online");
  });

  it("falls back to scanning the device for a voltage-like entity", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("battery_voltage"));
    addEntity(hass, "sensor.meshcore_spring_bat", state(4.1));
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain('data-entity="sensor.meshcore_spring_bat"');
    expect(body).toContain("4.10 V");
  });

  it("suppresses a near-zero battery voltage reading", () => {
    const hass = createHass();
    hass.states[nodeEntity("battery_voltage")] = state(0.0005);
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain("battery-block");
    expect(body).not.toContain("battery-voltage");
  });

  it("falls back to a voltage quick chip when no percentage exists", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("battery_percentage"));
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).not.toContain("battery-block");
    expect(body).toContain('icon="mdi:flash"');
    expect(body).toContain("4.08 V");
  });

  it("shows the firmware chip only for a real version string", () => {
    const hass = createHass();
    const withVersion = renderCard(
      { ...NODE_TARGET, show_firmware: true },
      hass
    ).body;
    expect(withVersion).toContain("v1.14.0");
    expect(withVersion).toContain('icon="mdi:memory"');

    hass.devices[NODE_DEVICE_ID]!.sw_version = "unknown";
    const withoutVersion = renderCard(
      { ...NODE_TARGET, show_firmware: true },
      hass
    ).body;
    expect(withoutVersion).not.toContain('icon="mdi:memory"');
  });

  it("classifies a repeater by its neighbor entities when metrics lag", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("airtime_utilization"));
    removeEntity(hass, nodeEntity("noise_floor"));
    addEntity(hass, "sensor.meshcore_spring_neighbor_aaaa01_seen", state(3));
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain('icon="mdi:radio-tower"');
  });

  it("classifies sensor and client nodes by their telemetry", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("airtime_utilization"));
    removeEntity(hass, nodeEntity("noise_floor"));
    expect(renderCard(NODE_TARGET, hass).body).toContain(
      'icon="mdi:access-point"'
    );
    removeEntity(hass, nodeEntity("temperature"));
    expect(renderCard(NODE_TARGET, hass).body).toContain(
      'icon="mdi:radio-handheld"'
    );
  });

  it("derives online state from request successes without an uptime sensor", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("uptime"));
    addEntity(hass, nodeEntity("request_successes"), state(5));
    expect(renderCard(NODE_TARGET, hass).body).toContain(">Online");
    hass.states[nodeEntity("request_successes")] = state(0);
    expect(renderCard(NODE_TARGET, hass).body).toContain("Offline");
  });

  it("strips MeshCore prefixes from node display names", () => {
    const spaced = createHass();
    spaced.devices[NODE_DEVICE_ID]!.name_by_user = "MeshCore Ridge";
    expect(
      renderCard({ target: { type: "node", id: "MeshCore Ridge" } }, spaced).body
    ).toContain('<span slot="primary">Ridge</span>');

    const unspaced = createHass();
    unspaced.devices[NODE_DEVICE_ID]!.name_by_user = "MeshCoreRidge";
    expect(
      renderCard({ target: { type: "node", id: "MeshCoreRidge" } }, unspaced).body
    ).toContain('<span slot="primary">Ridge</span>');
  });

  it("renders and fingerprints a node by device id without firmware metadata", () => {
    const hass = createHass();
    hass.devices[NODE_DEVICE_ID]!.name_by_user = null;
    hass.devices[NODE_DEVICE_ID]!.name = null;
    hass.devices[NODE_DEVICE_ID]!.sw_version = null;

    const { card, body } = renderCard(
      { target: { type: "node", id: NODE_DEVICE_ID } },
      hass
    );
    expect(body).toContain(`<span slot="primary">${NODE_DEVICE_ID}</span>`);
    expect(body).toContain(">Online");
    expect(card.getCardSize()).toBe(5);
  });

  it("omits the last-seen suffix without a last_advert reading", () => {
    const hass = createHass();
    removeEntity(hass, nodeEntity("last_advert"));
    const { body } = renderCard(NODE_TARGET, hass);
    expect(body).toContain('<span slot="secondary">Online</span>');
  });

  it("renders the node location from device coordinate entities", () => {
    const hass = createHass();
    addEntity(hass, nodeEntity("latitude"), state(-35.02));
    addEntity(hass, nodeEntity("longitude"), state(138.57));
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).toContain(t("card.location_section"));
    expect(body).toContain("-35.02000, 138.57000");
    expect(body).toContain("https://analyzer.letsmesh.net/map?lat=-35.02000");
  });

  it("renders explicit top and details chip zones in configured order", () => {
    const { body } = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: ["received"],
        details: ["sent", "temperature"],
        hidden: [],
      },
    });
    const quickRow = body.match(/<div class="quick-chip-row[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const detailRow = body.match(/<div class="detail-chips">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(quickRow).toContain(nodeEntity("nb_recv"));
    expect(quickRow).not.toContain(nodeEntity("nb_sent"));
    expect(detailRow).toContain(nodeEntity("nb_sent"));
    expect(detailRow).toContain(nodeEntity("temperature"));
    expect(detailRow.indexOf(nodeEntity("nb_sent"))).toBeLessThan(
      detailRow.indexOf(nodeEntity("temperature"))
    );
  });

  it("renders node firmware, spreading factor, and frequency in custom zones", () => {
    const hass = createHass();
    addEntity(hass, nodeEntity("spreading_factor"), state(9));
    addEntity(hass, nodeEntity("frequency"), state(915.5));
    const topMetrics = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: ["spreading_factor", "frequency"],
        details: ["firmware"],
        hidden: [],
      },
    }, hass).body;
    const quickRow = topMetrics.match(/<div class="quick-chip-row[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const detailRow = topMetrics.match(/<div class="detail-chips">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(quickRow).toContain("SF9");
    expect(quickRow).toContain("915.5 MHz");
    expect(detailRow).toContain("Firmware");
    expect(detailRow).toContain("v1.14.0");

    const sfDetails = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["spreading_factor"], hidden: [] },
    }, hass).body;
    expect(sfDetails.match(/<div class="detail-chips">([\s\S]*?)<\/div>/)?.[1]).toContain("SF9");
  });
});

describe("node neighbors list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A whole-second clock keeps the relative-age math free of rounding.
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  function neighborHass(): HomeAssistant {
    const hass = createHass();
    const ago = (seconds: number): string =>
      new Date(Date.now() - seconds * 1000).toISOString();
    const neighbor = (id: string, snr: number, seconds: number, resolvedName?: string): void =>
      addEntity(
        hass,
        `sensor.meshcore_spring_neighbor_${id}`,
        state(snr, { secs_ago: seconds, ...(resolvedName ? { resolved_name: resolvedName } : {}) }, ago(seconds))
      );
    neighbor("aaaa01", 12.5, 30, "Ridge Repeater");
    neighbor("bbbb02", 7, 300);
    neighbor("cccc03", 3, 7200);
    neighbor("dddd04", -5, 3 * 86400);
    neighbor("ffff06", 20, 48 * 60 * 60);
    // A timestamp-only legacy entity is excluded unless its rolling `_seen`
    // companion proves activity inside the 48-hour window.
    const staleChanged = state(1.5, {}, ago(600));
    staleChanged.last_changed = "";
    addEntity(hass, "sensor.meshcore_spring_neighbor_eeee05", staleChanged);
    addEntity(hass, "sensor.meshcore_spring_neighbor_aaaa01_seen", state(7));
    addEntity(hass, "sensor.meshcore_spring_neighbor_eeee05_seen", state(2));
    addEntity(
      hass,
      "binary_sensor.meshcore_55733c_ridge_contact",
      state("on", { adv_id: "aaaa01", adv_name: "Ridge Repeater" }),
      HUB_DEVICE_ID
    );
    addEntity(
      hass,
      "binary_sensor.meshcore_55733c_bbbb02_contact",
      state("on", { adv_name: "Valley Node" }),
      HUB_DEVICE_ID
    );
    return hass;
  }

  it("renders a number-only, localized dialog trigger in the top chip row", () => {
    const hass = neighborHass();
    hass.language = "de";
    hass.locale.language = "de";
    const de = makeLocalize("de");
    const { card } = renderCard(NODE_TARGET, hass);
    const chip = card.shadowRoot!.querySelector<HTMLButtonElement>(
      '.quick-chip[data-neighbors-dialog]'
    );

    expect(chip).not.toBeNull();
    expect(chip!.textContent?.trim()).toBe("4");
    expect(chip!.textContent).not.toContain(de("card.neighbors_label"));
    expect(chip!.textContent).not.toContain("48");
    const accessibleLabel = de("card.neighbors_48h", { n: 4 });
    expect(chip!.getAttribute("aria-label")).toBe(accessibleLabel);
    expect(chip!.getAttribute("title")).toBe(accessibleLabel);
    expect(chip!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(chip!.hasAttribute("data-entity")).toBe(false);
  });

  it.each([
    { placement: "top", countEntity: true },
    { placement: "details", countEntity: false },
  ])(
    "opens the custom dialog from the $placement placement without Neighbor Count more-info",
    ({ placement, countEntity }) => {
      const hass = neighborHass();
      const countEntityId = "sensor.meshcore_spring_neighbor_count";
      if (countEntity) addEntity(hass, countEntityId, state(4));
      const { card } = renderCard({
        ...NODE_TARGET,
        details_default_open: placement === "details",
        chip_layout: {
          top: placement === "top" ? ["neighbor_count"] : [],
          details: placement === "details" ? ["neighbor_count"] : [],
          hidden: [],
        },
      }, hass);
      const moreInfo = vi.fn();
      card.addEventListener("hass-more-info", moreInfo);
      const trigger = card.shadowRoot!.querySelector<HTMLButtonElement>(
        placement === "top"
          ? '.quick-chip[data-neighbors-dialog]'
          : '.detail-chips [data-neighbors-dialog]'
      );

      expect(trigger).not.toBeNull();
      const detail = clickForDialog(card, trigger!);
      expect(detail.dialogParams).toMatchObject({
        title: NODE_NAME,
        maxNeighbors: undefined,
        snapshot: {
          supported: true,
          countEntityId: countEntity ? countEntityId : null,
        },
      });
      expect(moreInfo).not.toHaveBeenCalled();
    }
  );

  it("loads the dialog and renders the same full, ordered neighbor list as Details", async () => {
    const hass = neighborHass();
    const { card } = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
    }, hass);
    const detail = clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    );
    const dialog = await instantiateDialog(detail);
    const root = dialog.shadowRoot!;
    const popupNames = Array.from(
      root.querySelectorAll<HTMLElement>(".neighbor-name")
    ).map((element) => element.textContent?.trim());
    const detailNames = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        "details.node-details .neighbors-list .neighbor-name"
      )
    ).map((element) => element.textContent?.trim());

    expect(root.querySelector(".count-badge")?.textContent).toBe("4");
    expect(popupNames).toEqual(detailNames);
    expect(popupNames).toEqual([
      "Ridge Repeater",
      "Valley Node",
      "cccc03",
      "eeee05",
    ]);
    expect(root.textContent).toContain("12.5 dB");
    expect(root.textContent).toContain("Last seen: 30s");
    expect(root.textContent).toContain("Receptions (48h): 7x");
  });

  it("supports Home Assistant's legacy showDialog initialization hook", async () => {
    const hass = neighborHass();
    const { card } = renderCard(NODE_TARGET, hass);
    const detail = clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    );
    await detail.dialogImport();
    const dialog = document.createElement(detail.dialogTag) as TestDialogElement;

    document.body.appendChild(dialog);
    dialog.showDialog(detail.dialogParams);

    expect(dialog.params).toBe(detail.dialogParams);
    expect(
      dialog.shadowRoot!.querySelector(".count-badge")?.textContent
    ).toBe("4");
    expect(dialog.shadowRoot!.querySelectorAll(".neighbor-row")).toHaveLength(4);
  });

  it("applies max_neighbors in the dialog while retaining the full count", async () => {
    const hass = neighborHass();
    const { card } = renderCard({ ...NODE_TARGET, max_neighbors: 2 }, hass);
    const detail = clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    );
    const dialog = await instantiateDialog(detail);
    const root = dialog.shadowRoot!;
    const names = Array.from(
      root.querySelectorAll<HTMLElement>(".neighbor-name")
    ).map((element) => element.textContent?.trim());

    expect(detail.dialogParams).toMatchObject({ maxNeighbors: 2 });
    expect(root.querySelector(".count-badge")?.textContent).toBe("4");
    expect(root.querySelectorAll(".neighbor-row")).toHaveLength(2);
    expect(names).toEqual(["Ridge Repeater", "Valley Node"]);
  });

  it.each([0, Infinity])(
    "treats max_neighbors %s as an uncapped dialog list",
    async (maxNeighbors) => {
      const hass = neighborHass();
      const { card } = renderCard({
        ...NODE_TARGET,
        max_neighbors: maxNeighbors,
      }, hass);
      const detail = clickForDialog(
        card,
        card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
      );
      const dialog = await instantiateDialog(detail);

      expect(detail.dialogParams).toMatchObject({ maxNeighbors });
      expect(
        dialog.shadowRoot!.querySelector(".count-badge")?.textContent
      ).toBe("4");
      expect(
        dialog.shadowRoot!.querySelectorAll(".neighbor-row")
      ).toHaveLength(4);
    }
  );

  it("opens a zero-count dialog with the shared empty state", async () => {
    const hass = createHass();
    addEntity(hass, "sensor.meshcore_spring_neighbor_count", state(0));
    const { card } = renderCard(NODE_TARGET, hass);
    const trigger = card.shadowRoot!.querySelector<HTMLButtonElement>(
      '.quick-chip[data-neighbors-dialog]'
    )!;
    const moreInfo = vi.fn();
    card.addEventListener("hass-more-info", moreInfo);

    expect(trigger.textContent?.trim()).toBe("0");
    const dialog = await instantiateDialog(clickForDialog(card, trigger));
    const root = dialog.shadowRoot!;
    expect(moreInfo).not.toHaveBeenCalled();
    expect(root.querySelector(".count-badge")?.textContent).toBe("0");
    expect(root.querySelectorAll(".neighbor-row")).toHaveLength(0);
    expect(root.querySelector(".neighbors-empty")?.textContent).toBe(
      t("card.no_recent_neighbors")
    );
  });

  it("keeps neighbor name and SNR more-info actions inside the dialog", async () => {
    const hass = neighborHass();
    const { card } = renderCard(NODE_TARGET, hass);
    const dialog = await instantiateDialog(clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    ));
    const seen: string[] = [];
    dialog.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as Event & { detail: { entityId: string } }).detail.entityId
      );
    });

    dialog.shadowRoot!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(seen).toEqual([]);
    dispatch(dialog.shadowRoot!.querySelector(".neighbor-name")!, "click");
    dispatch(dialog.shadowRoot!.querySelector(".neighbor-snr")!, "click");
    expect(seen).toEqual([
      "binary_sensor.meshcore_55733c_ridge_contact",
      "sensor.meshcore_spring_neighbor_aaaa01",
    ]);
  });

  it("closes through the custom dialog lifecycle", async () => {
    const hass = neighborHass();
    const { card } = renderCard(NODE_TARGET, hass);
    const dialog = await instantiateDialog(clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    ));
    const closed = vi.fn();
    dialog.addEventListener("dialog-closed", closed);

    expect(
      dialog.shadowRoot!.querySelector("ha-adaptive-dialog, dialog")
    ).not.toBeNull();
    dialog.closeDialog();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(dialog.isConnected).toBe(false);
  });

  it("closes an uninitialized dialog once", async () => {
    const hass = neighborHass();
    const { card } = renderCard(NODE_TARGET, hass);
    const detail = clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    );
    await detail.dialogImport();
    const dialog = document.createElement(detail.dialogTag) as TestDialogElement;
    const closed = vi.fn();
    dialog.addEventListener("dialog-closed", closed);
    document.body.appendChild(dialog);

    expect(dialog.closeDialog()).toBe(true);
    expect(dialog.closeDialog()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(dialog.isConnected).toBe(false);
  });

  it.each(["cancel", "scrim", "button"] as const)(
    "closes the native fallback after a %s dismissal",
    async (eventType) => {
      const hass = neighborHass();
      const { card } = renderCard(NODE_TARGET, hass);
      const dialog = await instantiateDialog(clickForDialog(
        card,
        card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
      ));
      const surface = dialog.shadowRoot!
        .querySelector<HTMLDialogElement>("dialog")!;
      const closed = vi.fn();
      dialog.addEventListener("dialog-closed", closed);

      const target = eventType === "button"
        ? surface.querySelector(".fallback-close")!
        : surface;
      target.dispatchEvent(eventType === "cancel"
        ? new Event("cancel", { bubbles: false, cancelable: true })
        : new MouseEvent("click", { bubbles: true }));

      expect(closed).toHaveBeenCalledTimes(1);
      expect(dialog.isConnected).toBe(false);
    }
  );

  it("uses the native open fallback when showModal throws", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal")
      .mockImplementation(() => {
        throw new Error("showModal unavailable");
      });

    try {
      const hass = neighborHass();
      const { card } = renderCard(NODE_TARGET, hass);
      const dialog = await instantiateDialog(clickForDialog(
        card,
        card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
      ));
      const surface = dialog.shadowRoot!
        .querySelector<HTMLDialogElement>("dialog")!;
      const closed = vi.fn();
      dialog.addEventListener("dialog-closed", closed);

      expect(surface.hasAttribute("open")).toBe(true);
      surface.removeAttribute("open");
      expect(dialog.closeDialog()).toBe(true);
      surface.dispatchEvent(new Event("close"));

      expect(closed).toHaveBeenCalledTimes(1);
      expect(dialog.isConnected).toBe(false);
    } finally {
      showModal.mockRestore();
    }
  });

  it("uses the native open fallback when showModal is unavailable", async () => {
    const prototype = HTMLDialogElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "showModal");
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      const hass = neighborHass();
      const { card } = renderCard(NODE_TARGET, hass);
      const dialog = await instantiateDialog(clickForDialog(
        card,
        card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
      ));
      const surface = dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;

      expect(surface.hasAttribute("open")).toBe(true);
      expect(dialog.closeDialog()).toBe(true);
      expect(dialog.isConnected).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(prototype, "showModal", descriptor);
      else delete (prototype as unknown as { showModal?: unknown }).showModal;
    }
  });

  it("uses Home Assistant's adaptive dialog when it is available", async () => {
    defineOnce("ha-adaptive-dialog", class extends HTMLElement {
      open = false;
      width = "medium";
      headerTitle = "";
    });
    const hass = neighborHass();
    const { card } = renderCard({ ...NODE_TARGET, name: "Hilltop" }, hass);
    const dialog = await instantiateDialog(clickForDialog(
      card,
      card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
    ));
    const surface = dialog.shadowRoot!.querySelector<HTMLElement & {
      open: boolean;
      width: string;
      headerTitle: string;
    }>("ha-adaptive-dialog")!;
    const closed = vi.fn();
    dialog.addEventListener("dialog-closed", closed);

    expect(surface.open).toBe(true);
    expect(surface.width).toBe("small");
    expect(surface.headerTitle).toBe("Hilltop");
    dialog.closeDialog();
    expect(surface.open).toBe(false);
    expect(dialog.isConnected).toBe(true);
    surface.dispatchEvent(new Event("closed"));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(dialog.isConnected).toBe(false);
  });

  it("returns an unsupported snapshot without neighbor context", () => {
    const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
    const internal = card as unknown as {
      _getNeighbors(deviceId: string): unknown;
    };
    const unsupported = { supported: false, countEntityId: null, neighbors: [] };

    expect(internal._getNeighbors(NODE_DEVICE_ID)).toEqual(unsupported);
    card.hass = createHass();
    expect(internal._getNeighbors("")).toEqual(unsupported);
  });

  it("does not render an unsupported shared neighbor snapshot", () => {
    expect(renderNeighborSection({
      supported: false,
      countEntityId: null,
      neighbors: [],
    }, t)).toBe("");
  });

  it.each([
    ["missing Home Assistant state", NODE_TARGET, undefined],
    [
      "disabled neighbors",
      { ...NODE_TARGET, show_neighbors: false },
      createHass(),
    ],
    ["a hub target", HUB_TARGET, createHass()],
    [
      "an unresolved node",
      { target: { type: "node" as const, id: "Missing" } },
      createHass(),
    ],
    ["unsupported neighbor telemetry", NODE_TARGET, createHass()],
  ])("does not open the neighbors dialog for %s", (_name, config, hass) => {
    const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
    card.setConfig(config as MeshcoreCardConfig);
    if (hass) card.hass = hass;
    const shown = vi.fn();
    card.addEventListener("show-dialog", shown);

    (card as unknown as { _showNeighborsDialog(): void })._showNeighborsDialog();

    expect(shown).not.toHaveBeenCalled();
  });

  it.each([
    ["de", "de"],
    [undefined, "en"],
  ] as const)(
    "uses locale %s after a missing primary language",
    (localeLanguage, expectedLanguage) => {
      const hass = neighborHass();
      (hass as unknown as { language?: string }).language = undefined;
      (hass.locale as { language?: string }).language = localeLanguage;
      hass.localize = vi.fn(() => "Localized close");
      const { card } = renderCard(NODE_TARGET, hass);
      const detail = clickForDialog(
        card,
        card.shadowRoot!.querySelector('[data-neighbors-dialog]')!
      );
      const params = detail.dialogParams as {
        closeLabel: string;
        localize: typeof t;
      };

      expect(params.localize("card.details")).toBe(
        makeLocalize(expectedLanguage)("card.details")
      );
      expect(params.closeLabel).toBe("Localized close");
      expect(hass.localize).toHaveBeenCalledWith("ui.common.close");
    }
  );

  it("lists only strict 48-hour neighbors sorted by raw SNR", () => {
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      neighborHass()
    );
    expect(body).toContain('<span class="count-badge">4</span>');
    // resolved_name is preferred; contact entities remain a fallback.
    expect(body).toContain("Ridge Repeater");
    expect(body).toContain("Valley Node");
    expect(body).toContain("cccc03");
    expect(body).not.toMatch(/neighbor-snr (green|yellow|orange|red)/);
    expect(body).toContain("12.5 dB");
    // Ages come only from secs_ago. The seen-only fallback stays deliberately broad.
    expect(body).toContain(": 30s");
    expect(body).toContain(": 5m");
    expect(body).toContain(": 2h");
    expect(body).toContain(": within 48h");
    expect(body).not.toContain("dddd04");
    expect(body).not.toContain("ffff06");
    // The seen counter renders as the connection count.
    expect(body).toContain("Receptions (48h): 7x");
    expect(body).toContain(
      'data-entity="binary_sensor.meshcore_55733c_ridge_contact"'
    );
    // Best SNR first.
    expect(body.indexOf("Ridge Repeater")).toBeLessThan(
      body.indexOf("Valley Node")
    );
  });

  it("keeps the neighbor ID when a matching contact has no name", () => {
    const hass = createHass();
    addEntity(
      hass,
      "sensor.meshcore_spring_neighbor_cafe01",
      state(8.5, { secs_ago: 15 })
    );
    addEntity(
      hass,
      "binary_sensor.meshcore_cafe01_contact",
      state("on", { adv_id: "cafe01" }),
      HUB_DEVICE_ID
    );
    const { card } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    const name = card.shadowRoot!.querySelector<HTMLElement>(".neighbor-name");
    expect(name?.dataset["entity"]).toBe(
      "binary_sensor.meshcore_cafe01_contact"
    );
    expect(name?.textContent).toBe("cafe01");
  });

  it("caps the visible list at max_neighbors but keeps the full count", () => {
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true, max_neighbors: 2 },
      neighborHass()
    );
    expect(body).toContain('<span class="count-badge">4</span>');
    expect(body).toContain("Ridge Repeater");
    expect(body).toContain("Valley Node");
    expect(body).not.toContain("cccc03");
    expect(body).not.toContain("dddd04");
  });

  it("hides the section entirely when show_neighbors is off", () => {
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true, show_neighbors: false },
      neighborHass()
    );
    expect(body).not.toContain("neighbors-section");
    expect(body).not.toContain("data-neighbors-dialog");
  });

  it.each(["", "   "])("rejects an empty secs_ago value %j", (secsAgo) => {
    const hass = createHass();
    addEntity(
      hass,
      "sensor.meshcore_spring_neighbor_abcd01",
      state(8.5, { secs_ago: secsAgo, resolved_name: "Unaged Neighbor" })
    );
    addEntity(
      hass,
      "sensor.meshcore_spring_neighbor_abcd02",
      state(7.5, { secs_ago: 30, resolved_name: "Recent Neighbor" })
    );
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).not.toContain("Unaged Neighbor");
    expect(body).toContain("Recent Neighbor");
    expect(body).toContain('<span class="count-badge">1</span>');
  });

  it.each([0, "0"])("accepts a real zero secs_ago value %j", (secsAgo) => {
    const hass = createHass();
    addEntity(
      hass,
      "sensor.meshcore_spring_neighbor_abcd03",
      state(9, { secs_ago: secsAgo, resolved_name: "Just Heard" })
    );
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).toContain("Just Heard");
    expect(body).toContain("Last seen: 0s");
  });

  it("distinguishes supported zero neighbors from unavailable telemetry", () => {
    const unsupported = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
    }).body;
    expect(unsupported).not.toContain("neighbors-section");
    expect(unsupported).not.toContain("No neighbors heard in the last 48 hours");

    const hass = createHass();
    addEntity(hass, "sensor.meshcore_spring_neighbor_count", state(0));
    const supported = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    ).body;
    expect(supported).toContain("data-neighbors-dialog");
    expect(supported).toContain('<span class="count-badge">0</span>');
    expect(supported).toContain("No neighbors heard in the last 48 hours");
  });

  it("does not treat an unavailable neighbor count entity as supported", () => {
    const hass = createHass();
    addEntity(hass, "sensor.meshcore_spring_neighbor_count", state("unavailable"));
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).not.toContain("neighbors-section");
    expect(body).not.toContain("data-neighbors-dialog");
  });

  it("renders a dialog trigger for an entity-backed or derived count in Details", () => {
    const withCount = createHass();
    addEntity(withCount, "sensor.meshcore_spring_neighbor_count", state(0));
    const entityBacked = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["neighbor_count"], hidden: [] },
    }, withCount).body;
    expect(entityBacked).toContain("data-neighbors-dialog");
    expect(entityBacked).not.toContain('data-entity="sensor.meshcore_spring_neighbor_count"');
    expect(entityBacked).toContain('<span class="chip-label">Neighbors ');

    const withoutCount = createHass();
    addEntity(
      withoutCount,
      "sensor.meshcore_spring_neighbor_aabb01",
      state(6.5, { secs_ago: 30, resolved_name: "Static Count Neighbor" })
    );
    const staticCount = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["neighbor_count"], hidden: [] },
    }, withoutCount).body;
    expect(staticCount).toContain('class="chip clickable"');
    expect(staticCount).toContain("data-neighbors-dialog");
    expect(staticCount).toContain('<span class="chip-label">Neighbors ');
  });

  it("formats neighbor ages beyond one day", () => {
    const hass = createHass();
    addEntity(
      hass,
      "sensor.meshcore_spring_neighbor_aabb02",
      state(4, { secs_ago: 25 * 60 * 60, resolved_name: "Day Old Neighbor" })
    );
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).toContain("Day Old Neighbor");
    expect(body).toContain("Last seen: 1d");
  });

  it("ignores neighbor registry entries whose states are missing", () => {
    const hass = createHass();
    const seenOnlyId = "sensor.meshcore_spring_neighbor_aabb03_seen";
    const seenEntry = registryEntry(NODE_DEVICE_ID);
    seenEntry.entity_id = seenOnlyId;
    hass.entities[seenOnlyId] = seenEntry;
    addEntity(hass, "sensor.meshcore_spring_neighbor_aabb03", state(5));

    const snrOnlyId = "sensor.meshcore_spring_neighbor_aabb04";
    const snrEntry = registryEntry(NODE_DEVICE_ID);
    snrEntry.entity_id = snrOnlyId;
    hass.entities[snrOnlyId] = snrEntry;
    addEntity(hass, "sensor.meshcore_spring_neighbor_aabb04_seen", state(2));

    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );
    expect(body).toContain("data-neighbors-dialog");
    expect(body).not.toContain("aabb03");
    expect(body).not.toContain("aabb04");
  });
});

describe("device card sizing and layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports its lovelace sizing hints", () => {
    const { card } = renderCard(NODE_TARGET);
    expect(card.getGridOptions()).toEqual({
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 1,
    });
    expect(MeshcoreCard.getConfigElement().tagName.toLowerCase()).toBe(
      "mushroom-meshcore-card-editor"
    );
  });

  it("trims overflowing sections when rows are constrained", () => {
    const { card } = renderCard({
      ...NODE_TARGET,
      grid_options: { rows: 2 },
    });
    expect(card.shadowRoot!.innerHTML).toContain("grid-rows");
    // A second render cancels the first pending trim pass.
    card.setConfig({ ...NODE_TARGET, grid_options: { rows: 2 } } as MeshcoreCardConfig);
    expect(card.style.opacity).toBe("0");

    const haCard = card.shadowRoot!.querySelector("ha-card") as HTMLElement;
    Object.defineProperty(haCard, "clientHeight", { value: 100 });
    const sections = Array.from(
      haCard.querySelectorAll<HTMLElement>(".trim-section")
    );
    expect(sections.length).toBeGreaterThan(1);
    Object.defineProperty(sections[0]!, "offsetTop", { value: 10 });
    Object.defineProperty(sections[0]!, "offsetHeight", { value: 20 });
    Object.defineProperty(sections[1]!, "offsetTop", { value: 200 });
    Object.defineProperty(sections[1]!, "offsetHeight", { value: 50 });

    vi.advanceTimersByTime(50);
    expect(card.style.opacity).toBe("");
    expect(sections[0]!.style.visibility).toBe("");
    expect(sections[1]!.style.visibility).toBe("hidden");
  });

  it("re-trims after a details toggle and cancels the pass on disconnect", () => {
    const { card } = renderCard({ ...NODE_TARGET, grid_options: { rows: 2 } });
    document.body.appendChild(card);
    vi.advanceTimersByTime(50); // flush the initial trim pass
    expect(card.style.opacity).toBe("");

    const details = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      "details.node-details"
    )!;
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: true, composed: true }));
    expect(card.style.opacity).toBe("0");

    card.remove();
    vi.advanceTimersByTime(100);
    // The canceled frame never restores opacity — proof it did not run.
    expect(card.style.opacity).toBe("0");
  });
});
