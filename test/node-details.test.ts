import { describe, expect, it } from "vitest";
import type { HassEntity } from "home-assistant-js-websocket";
import { MeshcoreCard } from "../src/card.js";
import type {
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreChipId,
} from "../src/types.js";
import {
  HUB_PUBKEY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  createV29RepeaterHass,
  defineOnce,
  registryEntry,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);

const NODE_TARGET = { type: "node", id: NODE_NAME } as const;

const nodeEntity = (metric: string): string =>
  `${NODE_PREFIX}${metric}${NODE_SUFFIX}`;

function putMetric(
  hass: HomeAssistant,
  metric: string,
  value: unknown
): string {
  const entityId = nodeEntity(metric);
  const entityState: HassEntity = state(value);
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
  const entry = registryEntry(NODE_DEVICE_ID);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
  return entityId;
}

function removeMetric(hass: HomeAssistant, metric: string): void {
  const entityId = nodeEntity(metric);
  delete hass.states[entityId];
  delete hass.entities[entityId];
}

function renderCard(
  hass: HomeAssistant,
  config: MeshcoreCardConfig
): MeshcoreCard {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config);
  card.hass = hass;
  return card;
}

function categorizedHass(): HomeAssistant {
  const hass = createV29RepeaterHass();
  for (const [metric, value] of Object.entries({
    spreading_factor: 9,
    frequency: 915.5,
    bandwidth: 250,
    tx_power: 22,
    relayed: 81,
    canceled: 3,
    duplicate: 4,
    humidity: 62,
    illuminance: 450,
    pressure: 1013,
  })) {
    putMetric(hass, metric, value);
  }
  const neighborCountId = "sensor.meshcore_spring_neighbor_count";
  const neighborCount = state(0);
  neighborCount.entity_id = neighborCountId;
  hass.states[neighborCountId] = neighborCount;
  const neighborEntry = registryEntry(NODE_DEVICE_ID);
  neighborEntry.entity_id = neighborCountId;
  hass.entities[neighborCountId] = neighborEntry;
  return hass;
}

interface CategorySpec {
  heading: string;
  chips: readonly MeshcoreChipId[];
  entitySuffixes: readonly (string | null)[];
}

const CATEGORIES: readonly CategorySpec[] = [
  {
    heading: "Device",
    chips: ["firmware", "uptime"],
    entitySuffixes: [null, "uptime"],
  },
  {
    heading: "Network",
    chips: ["neighbor_count", "route", "path_length"],
    entitySuffixes: [null, "out_path", "out_path_len"],
  },
  {
    heading: "Radio",
    chips: ["spreading_factor", "frequency", "bandwidth", "tx_power"],
    entitySuffixes: ["spreading_factor", "frequency", "bandwidth", "tx_power"],
  },
  {
    heading: "Network Traffic",
    chips: [
      "sent",
      "received",
      "relayed",
      "sent_direct",
      "sent_flood",
      "received_direct",
      "received_flood",
    ],
    entitySuffixes: [
      "nb_sent",
      "nb_recv",
      "relayed",
      "sent_direct",
      "sent_flood",
      "recv_direct",
      "recv_flood",
    ],
  },
  {
    heading: "Airtime",
    chips: ["tx_airtime", "rx_airtime", "tx_airtime_total", "rx_airtime_total"],
    entitySuffixes: [
      "airtime_utilization",
      "rx_airtime_utilization",
      "airtime",
      "rx_airtime",
    ],
  },
  {
    heading: "Message Rates",
    chips: [
      "tx_rate",
      "rx_rate",
      "sent_direct_rate",
      "sent_flood_rate",
      "received_direct_rate",
      "received_flood_rate",
      "direct_duplicates_rate",
      "flood_duplicates_rate",
      "receive_errors_rate",
    ],
    entitySuffixes: [
      "nb_sent_rate",
      "nb_recv_rate",
      "sent_direct_rate",
      "sent_flood_rate",
      "recv_direct_rate",
      "recv_flood_rate",
      "direct_dups_rate",
      "flood_dups_rate",
      "recv_errors_rate",
    ],
  },
  {
    heading: "Reliability",
    chips: [
      "canceled",
      "duplicate",
      "direct_duplicates",
      "flood_duplicates",
      "queue_length",
      "queue_full_events",
      "receive_errors",
      "request_successes",
      "request_failures",
    ],
    entitySuffixes: [
      "canceled",
      "duplicate",
      "direct_dups",
      "flood_dups",
      "tx_queue_len",
      "full_evts",
      "recv_errors",
      "request_successes",
      "request_failures",
    ],
  },
  {
    heading: "Telemetry",
    chips: ["temperature", "humidity", "illuminance", "pressure"],
    entitySuffixes: ["temperature", "humidity", "illuminance", "pressure"],
  },
];

function sectionHeadings(card: MeshcoreCard): string[] {
  return Array.from(
    card.shadowRoot!.querySelectorAll<HTMLElement>(
      ".details-content > .detail-section > h4"
    )
  ).map((heading) => heading.textContent?.trim() ?? "");
}

describe("node Details categories", () => {
  it("groups every node chip into its semantic category and omits the inline neighbor list", () => {
    const card = renderCard(categorizedHass(), {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: [],
        details: CATEGORIES.flatMap(({ chips }) => [...chips]),
        hidden: [],
      },
    });
    const sections = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        ".details-content > .detail-section"
      )
    );

    expect(sectionHeadings(card)).toEqual(CATEGORIES.map(({ heading }) => heading));
    expect(sections).toHaveLength(CATEGORIES.length);
    for (const [index, spec] of CATEGORIES.entries()) {
      const chips = Array.from(
        sections[index]!.querySelectorAll<HTMLElement>(".detail-chips > .chip")
      );
      expect(chips, spec.heading).toHaveLength(spec.chips.length);
      expect(chips.map((chip) => chip.dataset["entity"]), spec.heading).toEqual(
        spec.entitySuffixes.map((suffix) => suffix ? nodeEntity(suffix) : undefined)
      );
    }
    expect(card.shadowRoot!.querySelector(
      ".neighbors-section, .neighbors-list, .neighbor-row"
    )).toBeNull();
    expect(card.shadowRoot!.querySelector("[data-neighbors-dialog]")).not.toBeNull();
  });

  it("preserves an interleaved explicit Details order without moving chips across categories", () => {
    const ordered: MeshcoreChipId[] = [
      "temperature",
      "route",
      "humidity",
      "sent",
      "received",
      "uptime",
    ];
    const card = renderCard(categorizedHass(), {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ordered, hidden: [] },
    });

    expect(sectionHeadings(card)).toEqual([
      "Telemetry",
      "Network",
      "Telemetry",
      "Network Traffic",
      "Device",
    ]);
    expect(Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".detail-chips [data-entity]")
    ).map((chip) => chip.dataset["entity"])).toEqual([
      nodeEntity("temperature"),
      nodeEntity("out_path"),
      nodeEntity("humidity"),
      nodeEntity("nb_sent"),
      nodeEntity("nb_recv"),
      nodeEntity("uptime"),
    ]);
  });

  it("does not render empty categories for hidden, missing, or invalid chips", () => {
    const hass = createHass();
    putMetric(hass, "out_path", "direct");
    putMetric(hass, "frequency", "unknown");
    const card = renderCard(hass, {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: [],
        details: ["frequency", "humidity", "route"],
        hidden: ["temperature"],
      },
    });

    expect(sectionHeadings(card)).toEqual(["Network"]);
    expect(card.shadowRoot!.textContent).not.toContain("Radio");
    expect(card.shadowRoot!.textContent).not.toContain("Telemetry");

    const empty = renderCard(hass, {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: [],
        details: ["frequency", "humidity"],
        hidden: [],
      },
    });
    expect(empty.shadowRoot!.querySelector("details.node-details")).toBeNull();
  });
});

describe("main-card chip hover labels", () => {
  it("gives every rendered compact and detail chip the same title and accessible label", () => {
    const hass = categorizedHass();
    removeMetric(hass, "battery_percentage");
    const card = renderCard(hass, {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: ["firmware", "temperature", "uptime", "neighbor_count", "spreading_factor"],
        details: ["route"],
        hidden: [],
      },
    });
    const chips = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        ".quick-chip-row .quick-chip, .detail-chips .chip"
      )
    );

    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.getAttribute("aria-label"), chip.outerHTML).toBeTruthy();
      expect(chip.getAttribute("title"), chip.outerHTML).toBe(
        chip.getAttribute("aria-label")
      );
    }
    expect(card.shadowRoot!.querySelector(`[data-entity="${nodeEntity("temperature")}"]`)?.getAttribute("title"))
      .toBe("Temp 25 °C");
    expect(card.shadowRoot!.querySelector(`.quick-chip[data-entity="${nodeEntity("uptime")}"]`)?.getAttribute("title"))
      .toBe("Uptime 1d 12h");
    expect(card.shadowRoot!.querySelector(`[data-entity="${nodeEntity("spreading_factor")}"]`)?.getAttribute("title"))
      .toBe("Spreading factor SF9");
    expect(card.shadowRoot!.querySelector(".quick-chip.static-chip")?.getAttribute("title"))
      .toBe("Firmware v1.14.0");
    expect(card.shadowRoot!.querySelector("[data-neighbors-dialog]")?.getAttribute("title"))
      .toBe("0 neighbors · 48h");

    const detailFirmware = renderCard(categorizedHass(), {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: { top: [], details: ["firmware"], hidden: [] },
    }).shadowRoot!.querySelector<HTMLElement>(".detail-chips .static-chip");
    expect(detailFirmware?.getAttribute("aria-label")).toBe("Firmware v1.14.0");
    expect(detailFirmware?.getAttribute("title")).toBe("Firmware v1.14.0");
  });

  it("labels hub hardware and firmware chips without relying on visible text", () => {
    const card = renderCard(createHass(), {
      target: { type: "hub", id: HUB_PUBKEY },
    });
    const chips = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(".quick-chip.static-chip")
    );

    expect(chips.map((chip) => chip.getAttribute("title"))).toEqual([
      "Hardware Test Hub",
      "Firmware 1.0",
    ]);
    for (const chip of chips) {
      expect(chip.getAttribute("title")).toBe(chip.getAttribute("aria-label"));
    }
  });

  it.each(["unknown", "unavailable"])(
    "keeps a readable tooltip when a generic chip value is %s",
    (value) => {
      const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
      const internal = card as unknown as {
        _chip(id: string, label: string, value: string): string;
      };
      const documentFragment = new DOMParser().parseFromString(
        internal._chip("sensor.test", "Status", value),
        "text/html"
      );
      const chip = documentFragment.querySelector(".chip");

      expect(chip?.textContent).toContain("—");
      expect(chip?.getAttribute("aria-label")).toBe("Status —");
      expect(chip?.getAttribute("title")).toBe("Status —");
    }
  );

  it("localizes category and compact spreading-factor hover labels", () => {
    const hass = categorizedHass();
    hass.language = "de";
    hass.locale.language = "de";
    const card = renderCard(hass, {
      target: NODE_TARGET,
      details_default_open: true,
      chip_layout: {
        top: ["spreading_factor", "uptime"],
        details: ["route"],
        hidden: [],
      },
    });

    expect(sectionHeadings(card)).toEqual(["Netzwerk"]);
    expect(card.shadowRoot!.querySelector(`[data-entity="${nodeEntity("spreading_factor")}"]`)?.getAttribute("title"))
      .toBe("Spreizfaktor SF9");
    expect(card.shadowRoot!.querySelector(`.quick-chip[data-entity="${nodeEntity("uptime")}"]`)?.getAttribute("title"))
      .toBe("Laufzeit 1d 12h");
  });
});
