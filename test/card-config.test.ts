import { describe, expect, it } from "vitest";
import { MeshcoreCard } from "../src/card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreCardConfig } from "../src/types.js";
import {
  HUB_PUBKEY,
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

function renderCard(
  config: unknown,
  hass: HomeAssistant = createHass()
): { card: MeshcoreCard; body: string } {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config as MeshcoreCardConfig);
  card.hass = hass;
  return { card, body: shadowBody(card) };
}

describe("main card target validation", () => {
  it("prompts for a device when the config has no target", () => {
    const { card, body } = renderCard({});
    expect(body).toContain(t("card.select_device_prompt"));
    expect(card.getCardSize()).toBe(1);
  });

  it("rejects unknown target types", () => {
    const { body } = renderCard({ target: { type: "gateway", id: "x" } });
    expect(body).toContain(t("card.select_device_prompt"));
  });

  it("rejects blank and non-string target ids", () => {
    expect(renderCard({ target: { type: "node", id: "   " } }).body).toContain(
      t("card.select_device_prompt")
    );
    expect(renderCard({ target: { type: "node", id: 42 } }).body).toContain(
      t("card.select_device_prompt")
    );
  });

  it("reports an unresolved hub target with its id", () => {
    const { card, body } = renderCard({ target: { type: "hub", id: "beef00" } });
    expect(body).toContain(t("card.target_not_found", { id: "beef00" }));
    expect(card.getCardSize()).toBe(1);
  });

  it("reports an unresolved node target with its id", () => {
    const { body } = renderCard({ target: { type: "node", id: "Missing Node" } });
    expect(body).toContain(t("card.target_not_found", { id: "Missing Node" }));
  });

  it("ships an empty stub config so the picker shows the prompt", () => {
    expect(MeshcoreCard.getStubConfig()).toEqual({});
  });
});

describe("main card hub rendering", () => {
  it("renders the selected hub with its online state and pubkey", () => {
    const { card, body } = renderCard({ target: { type: "hub", id: HUB_PUBKEY } });
    expect(body).toContain("test hub");
    expect(body).toContain(`Online · ${HUB_PUBKEY}`);
    expect(card.getCardSize()).toBe(5);
  });

  it("strips a MeshCore prefix from the hub display name", () => {
    const hass = createHass();
    hass.states["sensor.meshcore_ab12cd_node_count_meshcore_hub"] = state(1);
    const { body } = renderCard({ target: { type: "hub", id: "ab12cd" } }, hass);
    expect(body).toContain('<span slot="primary">hub</span>');
    expect(body).not.toContain('<span slot="primary">meshcore hub</span>');
  });
});

describe("main card node rendering", () => {
  const target = { target: { type: "node", id: NODE_NAME } };

  it("renders the resolved node with automatic device-scoped entities", () => {
    const { card, body } = renderCard(target);
    expect(body).toContain(NODE_NAME);
    expect(body).toContain(">Online");
    expect(body).toContain('class="metrics-grid');
    expect(body).toContain(
      `data-entity="${NODE_PREFIX}last_rssi${NODE_SUFFIX}"`
    );
    expect(body).toContain(
      `data-entity="${NODE_PREFIX}battery_percentage${NODE_SUFFIX}"`
    );
    expect(card.getCardSize()).toBe(5);
  });

  it("collapses an offline node to its header", () => {
    const { card, body } = renderCard(target, createHass({ online: false }));
    expect(body).toContain("Offline");
    expect(body).not.toContain('class="metrics-grid');
    expect(body).not.toContain("battery-block");
    expect(card.getCardSize()).toBe(1);
  });

  it("prefers a configured battery entity override over discovery", () => {
    const hass = createHass({
      extraStates: { "sensor.custom_battery": state(77) },
      extraEntities: { "sensor.custom_battery": registryEntry(null, "template") },
    });
    const { body } = renderCard({ ...target, battery_entity: "sensor.custom_battery" }, hass);
    expect(body).toContain('data-entity="sensor.custom_battery"');
    expect(body).toContain(">77%<");
    expect(body).not.toContain(
      `data-entity="${NODE_PREFIX}battery_percentage${NODE_SUFFIX}"`
    );
  });

  it("prefers a configured temperature entity override", () => {
    const hass = createHass({
      extraStates: { "sensor.outdoor_temp": state(7.5) },
      extraEntities: { "sensor.outdoor_temp": registryEntry(null, "template") },
    });
    const { body } = renderCard(
      { ...target, temperature_entity: "sensor.outdoor_temp" },
      hass
    );
    expect(body).toContain('data-entity="sensor.outdoor_temp"');
    expect(body).toContain(">7.5");
  });

  it("honors the flat hide_* booleans", () => {
    const visible = renderCard(target).body;
    expect(visible).toContain("battery-block");
    expect(visible).toContain('class="metrics-grid');
    expect(visible).toContain("quick-chip-row");

    const { body } = renderCard({
      ...target,
      hide_battery: true,
      hide_metrics: true,
      hide_quick_stats: true,
      hide_details: true,
    });
    expect(body).toContain(NODE_NAME); // still renders the header
    expect(body).not.toContain("battery-block");
    expect(body).not.toContain('class="metrics-grid');
    expect(body).not.toContain("quick-chip-row");
    expect(body).not.toContain("<details");
  });

  it("passes the config name, icon, and icon_color to the tile header", () => {
    const { body } = renderCard({
      ...target,
      name: "Farm Link",
      icon: "mdi:antenna",
      icon_color: "green",
    });
    expect(body).toContain('<span slot="primary">Farm Link</span>');
    expect(body).toContain('icon="mdi:antenna"');
    expect(body).toContain("--mushroom-meshcore-icon-override-color:var(--green-color)");
  });
});
