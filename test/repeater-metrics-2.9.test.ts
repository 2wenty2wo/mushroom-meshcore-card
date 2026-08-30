import { describe, expect, it } from "vitest";
import type { HassEntity } from "home-assistant-js-websocket";
import { MeshcoreCard } from "../src/card.js";
import type {
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreChipId,
} from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  V29_REPEATER_METRICS,
  createHass,
  createV29RepeaterHass,
  defineOnce,
  registryEntry,
  shadowBody,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);

const NODE_TARGET = { type: "node", id: NODE_NAME } as const;
const HUB_TARGET = { type: "hub", id: HUB_PUBKEY } as const;

const nodeEntity = (metric: string): string =>
  `${NODE_PREFIX}${metric}${NODE_SUFFIX}`;
const hubEntity = (metric: string): string =>
  `sensor.meshcore_${HUB_PUBKEY}_${metric}_test_hub`;

interface RepeaterMetricSpec {
  chip: MeshcoreChipId;
  suffix: keyof typeof V29_REPEATER_METRICS;
  label: string;
  unit: "" | " msg/min" | " min" | " requests";
  icon: string;
}

const NEW_REPEATER_METRICS: readonly RepeaterMetricSpec[] = [
  { chip: "sent_direct", suffix: "sent_direct", label: "Sent direct", unit: "", icon: "mdi:message-arrow-right" },
  { chip: "sent_flood", suffix: "sent_flood", label: "Sent flood", unit: "", icon: "mdi:message-arrow-right-outline" },
  { chip: "received_direct", suffix: "recv_direct", label: "Received direct", unit: "", icon: "mdi:message-arrow-left" },
  { chip: "received_flood", suffix: "recv_flood", label: "Received flood", unit: "", icon: "mdi:message-arrow-left-outline" },
  { chip: "direct_duplicates", suffix: "direct_dups", label: "Direct duplicates", unit: "", icon: "mdi:content-duplicate" },
  { chip: "flood_duplicates", suffix: "flood_dups", label: "Flood duplicates", unit: "", icon: "mdi:content-duplicate" },
  { chip: "queue_full_events", suffix: "full_evts", label: "Queue full events", unit: "", icon: "mdi:alert-circle" },
  { chip: "receive_errors", suffix: "recv_errors", label: "Receive errors", unit: "", icon: "mdi:message-alert" },
  { chip: "sent_direct_rate", suffix: "sent_direct_rate", label: "Sent direct rate", unit: " msg/min", icon: "mdi:message-arrow-right" },
  { chip: "sent_flood_rate", suffix: "sent_flood_rate", label: "Sent flood rate", unit: " msg/min", icon: "mdi:message-arrow-right-outline" },
  { chip: "received_direct_rate", suffix: "recv_direct_rate", label: "Received direct rate", unit: " msg/min", icon: "mdi:message-arrow-left" },
  { chip: "received_flood_rate", suffix: "recv_flood_rate", label: "Received flood rate", unit: " msg/min", icon: "mdi:message-arrow-left-outline" },
  { chip: "direct_duplicates_rate", suffix: "direct_dups_rate", label: "Direct duplicates rate", unit: " msg/min", icon: "mdi:content-duplicate" },
  { chip: "flood_duplicates_rate", suffix: "flood_dups_rate", label: "Flood duplicates rate", unit: " msg/min", icon: "mdi:content-duplicate" },
  { chip: "receive_errors_rate", suffix: "recv_errors_rate", label: "Receive errors rate", unit: " msg/min", icon: "mdi:message-alert" },
  { chip: "tx_airtime_total", suffix: "airtime", label: "TX airtime total", unit: " min", icon: "mdi:radio" },
  { chip: "rx_airtime_total", suffix: "rx_airtime", label: "RX airtime total", unit: " min", icon: "mdi:radio" },
  { chip: "request_successes", suffix: "request_successes", label: "Request successes", unit: " requests", icon: "mdi:check-circle" },
  { chip: "request_failures", suffix: "request_failures", label: "Request failures", unit: " requests", icon: "mdi:alert-circle" },
];

function putEntity(
  hass: HomeAssistant,
  entityId: string,
  entityState: HassEntity | null,
  deviceId = NODE_DEVICE_ID
): void {
  const entry = registryEntry(deviceId);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
  if (entityState) {
    entityState.entity_id = entityId;
    hass.states[entityId] = entityState;
  } else {
    delete hass.states[entityId];
  }
}

function putMetric(
  hass: HomeAssistant,
  metric: string,
  value: unknown,
  deviceId = NODE_DEVICE_ID
): string {
  const entityId = nodeEntity(metric);
  putEntity(hass, entityId, state(value), deviceId);
  return entityId;
}

function registerMetric(
  hass: HomeAssistant,
  metric: string,
  deviceId = NODE_DEVICE_ID
): string {
  const entityId = nodeEntity(metric);
  putEntity(hass, entityId, null, deviceId);
  return entityId;
}

function renderCard(
  hass: HomeAssistant,
  config: MeshcoreCardConfig = { target: NODE_TARGET, details_default_open: true }
): { card: MeshcoreCard; body: string } {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config);
  card.hass = hass;
  return { card, body: shadowBody(card) };
}

function compactText(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function onlyDetailChip(chip: MeshcoreChipId): MeshcoreCardConfig {
  return {
    target: NODE_TARGET,
    details_default_open: true,
    chip_layout: { top: [], details: [chip], hidden: [] },
  };
}

describe("MeshCore HA 2.9 repeater metrics", () => {
  it("renders every canonical metric with its public label, value, unit, and entity binding", () => {
    const { card, body } = renderCard(createV29RepeaterHass());
    const quickRow = card.shadowRoot!.querySelector(".quick-chip-row");
    const details = card.shadowRoot!.querySelector(".detail-chips");

    for (const spec of NEW_REPEATER_METRICS) {
      const entityId = nodeEntity(spec.suffix);
      const chip = details?.querySelector(`[data-entity="${entityId}"]`) ?? null;
      const expected = `${spec.label} ${V29_REPEATER_METRICS[spec.suffix]}${spec.unit}`;
      expect(chip, spec.chip).not.toBeNull();
      expect(compactText(chip), spec.chip).toBe(expected);
      expect(chip?.querySelector(".chip-label")?.textContent?.trim(), spec.chip)
        .toBe(spec.label);
      expect(quickRow?.querySelector(`[data-entity="${entityId}"]`), spec.chip)
        .toBeNull();
      expect(body, spec.chip).toContain(`data-entity="${entityId}"`);
    }
  });

  it("uses the MeshCore icons when canonical metrics are moved to the top row", () => {
    const hass = createV29RepeaterHass();
    const { card } = renderCard(hass, {
      target: NODE_TARGET,
      chip_layout: {
        top: NEW_REPEATER_METRICS.map(({ chip }) => chip),
        details: [],
        hidden: [],
      },
    });

    for (const spec of NEW_REPEATER_METRICS) {
      const entityId = nodeEntity(spec.suffix);
      const chip = card.shadowRoot!.querySelector(`[data-entity="${entityId}"]`);
      expect(chip?.querySelector("ha-icon")?.getAttribute("icon"), spec.chip)
        .toBe(spec.icon);
      expect(chip?.getAttribute("aria-label"), spec.chip).toBe(
        `${spec.label} ${V29_REPEATER_METRICS[spec.suffix]}${spec.unit}`
      );
    }
  });

  it("opens more-info for the exact entity behind every new metric", () => {
    const { card } = renderCard(createV29RepeaterHass());
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push((event as Event & { detail: { entityId: string } }).detail.entityId);
    });

    for (const spec of NEW_REPEATER_METRICS) {
      const entityId = nodeEntity(spec.suffix);
      card.shadowRoot!.querySelector(`[data-entity="${entityId}"]`)!.dispatchEvent(
        new Event("click", { bubbles: true, composed: true })
      );
    }

    expect(seen).toEqual(
      NEW_REPEATER_METRICS.map(({ suffix }) => nodeEntity(suffix))
    );
  });

  it("keeps TX and RX airtime totals distinct when RX is registered first", () => {
    const hass = createHass();
    const rxId = putMetric(hass, "rx_airtime", 8.25);
    const txId = putMetric(hass, "airtime", 17.5);
    const { card } = renderCard(hass, {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: [],
        details: ["tx_airtime_total", "rx_airtime_total"],
        hidden: [],
      },
    });

    const chips = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".detail-chips [data-entity]")
    );
    expect(chips.map((chip) => chip.dataset["entity"])).toEqual([txId, rxId]);
    expect(chips.map(compactText)).toEqual([
      "TX airtime total 17.5 min",
      "RX airtime total 8.25 min",
    ]);
  });

  it("keeps the exact default Details ordering around legacy traffic, airtime, rates, and reliability", () => {
    const hass = createV29RepeaterHass();
    putMetric(hass, "relayed", 91);
    putMetric(hass, "canceled", 92);
    putMetric(hass, "duplicate", 93);
    const { card } = renderCard(hass);
    const entityOrder = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".detail-chips [data-entity]")
    ).map((chip) => chip.dataset["entity"]);

    expect(entityOrder).toEqual([
      nodeEntity("out_path"),
      nodeEntity("out_path_len"),
      nodeEntity("relayed"),
      nodeEntity("canceled"),
      nodeEntity("duplicate"),
      nodeEntity("sent_direct"),
      nodeEntity("sent_flood"),
      nodeEntity("recv_direct"),
      nodeEntity("recv_flood"),
      nodeEntity("direct_dups"),
      nodeEntity("flood_dups"),
      nodeEntity("full_evts"),
      nodeEntity("recv_errors"),
      nodeEntity("airtime_utilization"),
      nodeEntity("rx_airtime_utilization"),
      nodeEntity("airtime"),
      nodeEntity("rx_airtime"),
      nodeEntity("tx_queue_len"),
      nodeEntity("nb_sent_rate"),
      nodeEntity("nb_recv_rate"),
      nodeEntity("sent_direct_rate"),
      nodeEntity("sent_flood_rate"),
      nodeEntity("recv_direct_rate"),
      nodeEntity("recv_flood_rate"),
      nodeEntity("direct_dups_rate"),
      nodeEntity("flood_dups_rate"),
      nodeEntity("recv_errors_rate"),
      nodeEntity("request_successes"),
      nodeEntity("request_failures"),
    ]);
  });

  it("places omitted v2.9 chips in Hidden for an explicit layout", () => {
    const { body } = renderCard(createV29RepeaterHass(), {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: ["sent"], details: ["received"], hidden: [] },
    });
    for (const { suffix } of NEW_REPEATER_METRICS) {
      expect(body).not.toContain(`data-entity="${nodeEntity(suffix)}"`);
    }
  });
});

describe("MeshCore HA 2.9 entity-name compatibility", () => {
  it.each([
    ["queue_length", "tx_queue_len", "queue_length", 4, 94],
    ["tx_rate", "nb_sent_rate", "tx_per_minute", 12.5, 92.5],
    ["rx_rate", "nb_recv_rate", "rx_per_minute", 9.75, 89.75],
    ["route", "out_path", "routing_path", "flood", "legacy"],
    ["path_length", "out_path_len", "path_length", 2, 82],
  ] as const)(
    "prefers canonical entity data for %s over divergent legacy data",
    (chip, canonical, legacy, canonicalValue, legacyValue) => {
      const hass = createV29RepeaterHass();
      const canonicalId = putMetric(hass, canonical, canonicalValue);
      const legacyId = putMetric(hass, legacy, legacyValue);
      const { body } = renderCard(hass, onlyDetailChip(chip));
      expect(body).toContain(`data-entity="${canonicalId}"`);
      expect(body).not.toContain(`data-entity="${legacyId}"`);
      expect(compactText(
        new DOMParser().parseFromString(body, "text/html")
          .querySelector(`[data-entity="${canonicalId}"]`)
      )).toContain(String(canonicalValue));
    }
  );

  it("prefers canonical bat voltage over battery_voltage", () => {
    const hass = createV29RepeaterHass();
    const canonicalId = putMetric(hass, "bat", 4.21);
    const legacyId = nodeEntity("battery_voltage");
    const { card, body } = renderCard(hass);
    expect(body).toContain(`data-entity="${canonicalId}"`);
    expect(body).not.toContain(`data-entity="${legacyId}"`);
    expect(compactText(card.shadowRoot!.querySelector(".battery-voltage")))
      .toBe("4.21 V");
  });

  it.each([
    ["queue_length", "tx_queue_len", [], "queue_length", 41],
    ["tx_rate", "nb_sent_rate", [], "tx_per_minute", 11],
    ["tx_rate", "nb_sent_rate", ["tx_per_minute"], "tx_rate", 12],
    ["tx_rate", "nb_sent_rate", ["tx_per_minute", "tx_rate"], "messages_per_minute", 13],
    ["rx_rate", "nb_recv_rate", [], "rx_per_minute", 21],
    ["rx_rate", "nb_recv_rate", ["rx_per_minute"], "rx_rate", 22],
    ["route", "out_path", [], "routing_path", "direct"],
    ["path_length", "out_path_len", [], "path_length", 3],
  ] as const)(
    "resolves %s through its state-backed alias chain",
    (chip, canonical, earlierAliases, legacy, legacyValue) => {
      const hass = createV29RepeaterHass();
      registerMetric(hass, canonical);
      for (const earlier of earlierAliases) registerMetric(hass, earlier);
      const legacyId = putMetric(hass, legacy, legacyValue);
      const { body } = renderCard(hass, onlyDetailChip(chip));
      expect(body).toContain(`data-entity="${legacyId}"`);
    }
  );

  it("falls through a state-less bat entity to battery_voltage", () => {
    const hass = createV29RepeaterHass();
    registerMetric(hass, "bat");
    const legacyId = nodeEntity("battery_voltage");
    const { body } = renderCard(hass);
    expect(body).toContain(`data-entity="${legacyId}"`);
  });

  it("falls through state-less named voltage entities to the existing device scan", () => {
    const hass = createV29RepeaterHass();
    registerMetric(hass, "bat");
    registerMetric(hass, "battery_voltage");
    const scannedId = "sensor.meshcore_spring_aux_bat_reading";
    putEntity(hass, scannedId, state(4.33));
    const { card, body } = renderCard(hass);
    expect(body).toContain(`data-entity="${scannedId}"`);
    expect(compactText(card.shadowRoot!.querySelector(".battery-voltage")))
      .toBe("4.33 V");
  });

  it.each([
    ["queue_length", "tx_queue_len", "queue_length", "not-a-number", 51],
    ["tx_rate", "nb_sent_rate", "tx_per_minute", "unknown", 52],
    ["rx_rate", "nb_recv_rate", "rx_per_minute", "unavailable", 53],
    ["route", "out_path", "routing_path", "unknown", "legacy"],
    ["path_length", "out_path_len", "path_length", "", 55],
  ] as const)(
    "hides invalid canonical data for %s instead of exposing stale legacy data",
    (chip, canonical, legacy, invalidValue, legacyValue) => {
      const hass = createV29RepeaterHass();
      const canonicalId = putMetric(hass, canonical, invalidValue);
      const legacyId = putMetric(hass, legacy, legacyValue);
      const { body } = renderCard(hass, onlyDetailChip(chip));
      expect(body).not.toContain(`data-entity="${canonicalId}"`);
      expect(body).not.toContain(`data-entity="${legacyId}"`);
    }
  );

  it("hides invalid canonical bat data instead of exposing stale battery_voltage", () => {
    const hass = createV29RepeaterHass();
    const canonicalId = putMetric(hass, "bat", "not-a-number");
    const legacyId = nodeEntity("battery_voltage");
    const { body } = renderCard(hass);
    expect(body).not.toContain(`data-entity="${canonicalId}"`);
    expect(body).not.toContain(`data-entity="${legacyId}"`);
    expect(body).not.toContain("battery-voltage");
  });
});

describe("MeshCore HA 2.9 metric absence and device scope", () => {
  it.each([undefined, "", "unknown", "unavailable", "not-a-number"])(
    "hides every new numeric metric when its state is %s",
    (invalidState) => {
      const hass = createHass();
      for (const { suffix } of NEW_REPEATER_METRICS) {
        if (invalidState === undefined) registerMetric(hass, suffix);
        else putMetric(hass, suffix, invalidState);
      }
      const { body } = renderCard(hass);
      for (const { suffix } of NEW_REPEATER_METRICS) {
        expect(body).not.toContain(`data-entity="${nodeEntity(suffix)}"`);
      }
    }
  );

  it("ignores same-named repeater metrics attached to another device", () => {
    const hass = createHass();
    for (const { suffix } of NEW_REPEATER_METRICS) {
      putMetric(hass, suffix, 99, "other-device");
    }
    const { body } = renderCard(hass);
    for (const { suffix } of NEW_REPEATER_METRICS) {
      expect(body).not.toContain(`data-entity="${nodeEntity(suffix)}"`);
    }
  });

  it("does not surface repeater companion self-diagnostics on a hub card", () => {
    const hass = createHass();
    for (const [metric, value] of Object.entries(V29_REPEATER_METRICS)) {
      putEntity(hass, hubEntity(metric), state(value), HUB_DEVICE_ID);
    }
    const { body } = renderCard(hass, {
      target: HUB_TARGET,
      details_default_open: true,
    });
    for (const metric of Object.keys(V29_REPEATER_METRICS)) {
      expect(body).not.toContain(`data-entity="${hubEntity(metric)}"`);
    }
  });
});
