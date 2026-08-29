// Interactive and stateful behavior of the device card: delegated pointer
// handling, refresh timers, hub/node detail sections, and the neighbors list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HassEntity } from "home-assistant-js-websocket";
import { MeshcoreCard } from "../src/card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreCardConfig } from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  NODE_DEVICE_ID,
  NODE_NAME,
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
  deviceId: string | null = NODE_DEVICE_ID
): void {
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
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

  it("throttles state-driven renders to one per ten seconds", () => {
    const { card } = renderCard(NODE_TARGET);
    expect(shadowBody(card)).toContain(">Online");
    card.hass = createHass({ online: false });
    // Two quick updates share one deferred render slot.
    card.hass = createHass({ online: false });
    expect(shadowBody(card)).toContain(">Online");
    vi.advanceTimersByTime(10_000);
    expect(shadowBody(card)).toContain("Offline");
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

  it("lists only strict 48-hour neighbors sorted by raw SNR", () => {
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      neighborHass()
    );
    expect(body).toContain('<span class="count-badge">4</span>');
    expect(body).toContain("4 neighbors · 48h");
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
    const { body } = renderCard(
      { ...NODE_TARGET, details_default_open: true },
      hass
    );

    expect(body).toContain(
      'data-entity="binary_sensor.meshcore_cafe01_contact">cafe01</button>'
    );
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
    expect(body).not.toContain("neighbors · 48h");
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
    expect(body).toContain("1 neighbor · 48h");
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
    expect(supported).toContain("0 neighbors · 48h");
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
    expect(body).not.toContain("0 neighbors · 48h");
  });

  it("renders an entity-backed or static neighbor count in Details", () => {
    const withCount = createHass();
    addEntity(withCount, "sensor.meshcore_spring_neighbor_count", state(0));
    const entityBacked = renderCard({
      ...NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["neighbor_count"], hidden: [] },
    }, withCount).body;
    expect(entityBacked).toContain('data-entity="sensor.meshcore_spring_neighbor_count"');
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
    expect(staticCount).toContain('<span class="chip static-chip"');
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
    expect(body).toContain("0 neighbors · 48h");
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
