import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshcoreStatusCard } from "../src/status-card.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HomeAssistant,
  MeshcoreStatusCardConfig,
} from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  HUB_STATUS_ENTITY,
  NODE_DEVICE_ID,
  NODE_ONLINE_ENTITY,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  defineOnce,
  registryEntry,
  shadowBody,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-status-card", MeshcoreStatusCard);

const t = makeLocalize("en");
const target = { type: "hub", id: HUB_PUBKEY } as const;

function addEntity(
  hass: HomeAssistant,
  entityId: string,
  value: unknown,
  deviceId = NODE_DEVICE_ID,
  attributes: Record<string, unknown> = {}
): void {
  const entityState = state(value, attributes);
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

function statusHass(onlineState = "on"): HomeAssistant {
  const hass = createHass();
  addEntity(hass, NODE_ONLINE_ENTITY, onlineState);
  return hass;
}

function createCard(
  config: MeshcoreStatusCardConfig = { target },
  hass: HomeAssistant = statusHass()
): MeshcoreStatusCard {
  const card = document.createElement(
    "mushroom-meshcore-status-card"
  ) as MeshcoreStatusCard;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("MeshcoreStatusCard", () => {
  it("requires one explicit, resolvable hub and ships an empty stub", () => {
    const missing = createCard({});
    expect(shadowBody(missing)).toContain(t("card.status_select_hub_prompt"));
    expect(missing.getCardSize()).toBe(1);

    const unresolved = createCard({
      target: { type: "hub", id: "badcafe" },
    });
    expect(shadowBody(unresolved)).toContain(
      t("card.status_target_not_found", { id: "badcafe" })
    );
    expect(MeshcoreStatusCard.getStubConfig()).toEqual({});
    expect(MeshcoreStatusCard.getConfigElement().localName).toBe(
      "mushroom-meshcore-status-card-editor"
    );

    const malformed = createCard({
      target: { type: "hub", id: 42 } as unknown as typeof target,
    });
    expect(shadowBody(malformed)).toContain(t("card.status_select_hub_prompt"));
  });

  it("renders a calm Tile summary and collapsed monitored-node disclosure", () => {
    const card = createCard();
    const body = shadowBody(card);
    expect(card.shadowRoot!.querySelector("ha-card")).not.toBeNull();
    expect(body).toContain('<span slot="primary">Test Hub</span>');
    expect(body).toContain(t("card.status_healthy"));
    expect(body).toContain(
      t("card.status_online_count", { online: 1, total: 1 })
    );
    expect(body).toContain(t("card.status_no_active_issues"));
    const monitored = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      '[data-disclosure="monitored-nodes"]'
    )!;
    expect(monitored).not.toBeNull();
    expect(monitored.open).toBe(false);
    const diagnostics = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      '[data-disclosure="diagnostics"]'
    )!;
    expect(diagnostics).not.toBeNull();
    expect(diagnostics.open).toBe(false);
    expect(diagnostics.textContent).toContain(t("card.status_no_diagnostics"));
  });

  it("makes one entity-backed finding directly actionable", () => {
    const hass = statusHass();
    const battery = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[battery]!.state = "49";
    const card = createCard({ target }, hass);
    expect(
      card.shadowRoot!.querySelector('[data-disclosure="issue:low_battery"]')
    ).toBeNull();
    expect(
      card.shadowRoot!.querySelector(`[data-entity="${battery}"]`)
    ).not.toBeNull();
    expect(shadowBody(card)).toContain("1 issue · 1/1 online");
  });

  it("groups multiple findings of one problem into a collapsed disclosure", () => {
    const hass = statusHass();
    hass.states[`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`]!.state = "40";
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_battery_percentage_test_hub`,
      20,
      HUB_DEVICE_ID,
      { unit_of_measurement: "%" }
    );
    const card = createCard({ target }, hass);
    const issue = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      '[data-disclosure="issue:low_battery"]'
    )!;
    expect(issue).not.toBeNull();
    expect(issue.open).toBe(false);
    expect(issue.querySelector("summary")?.textContent).toContain(
      t("card.status_low_batteries")
    );
    expect(issue.querySelectorAll("[data-entity]")).toHaveLength(2);
  });

  it("keeps unknown checks separate while retaining the online denominator", () => {
    const card = createCard({ target }, statusHass("unknown"));
    expect(shadowBody(card)).toContain("0/1 online · 1 node unknown");
    expect(
      card.shadowRoot!.querySelector('[data-row-id="node:node-device:status"]')
    ).not.toBeNull();
    expect(card.shadowRoot!.querySelector("ha-card")?.className).toContain(
      "status-healthy"
    );
  });

  it("keeps unresolved legacy node status rows actionable", () => {
    const hass = createHass();
    const uptime = `${NODE_PREFIX}uptime${NODE_SUFFIX}`;
    const legacy = `${NODE_PREFIX}status${NODE_SUFFIX}`;
    removeEntity(hass, uptime);
    addEntity(hass, legacy, "unavailable");
    const card = createCard({ target }, hass);
    const monitored = card.shadowRoot!.querySelector<HTMLButtonElement>(
      `[data-row-id="${NODE_DEVICE_ID}"][data-entity="${legacy}"]`
    );
    const unknown = card.shadowRoot!.querySelector<HTMLButtonElement>(
      `[data-row-id="node:${NODE_DEVICE_ID}:status"][data-entity="${legacy}"]`
    );
    expect(monitored).not.toBeNull();
    expect(unknown).not.toBeNull();

    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push((event as CustomEvent<{ entityId: string }>).detail.entityId);
    });
    monitored!.click();
    unknown!.click();
    expect(seen).toEqual([legacy, legacy]);
  });

  it("shows one critical hub issue and suppresses cached child checks", () => {
    const hass = statusHass("off");
    hass.states[HUB_STATUS_ENTITY]!.state = "offline";
    const card = createCard({ target }, hass);
    const body = shadowBody(card);
    expect(body).toContain(t("card.status_hub_offline"));
    expect(body).toContain(t("card.status_downstream_paused"));
    expect(body).not.toContain('data-disclosure="monitored-nodes"');
    expect(body).not.toContain('data-disclosure="issue:node_offline"');
    expect(card.shadowRoot!.querySelector("ha-card")?.className).toContain(
      "status-critical"
    );
  });

  it("honors exclusions, visibility controls, disclosure defaults, and grid sizing", () => {
    const hass = statusHass();
    addEntity(
      hass,
      `${NODE_PREFIX}request_failures${NODE_SUFFIX}`,
      7
    );
    const hidden = createCard(
      {
        target,
        excluded_nodes: ["Spring Farm"],
        hide_monitored_nodes: true,
        hide_diagnostics: true,
        grid_options: { rows: 4, columns: "full" },
      },
      hass
    );
    expect(shadowBody(hidden)).toContain(t("card.status_no_monitored_nodes"));
    expect(shadowBody(hidden)).not.toContain("<details");
    expect(hidden.shadowRoot!.querySelector("ha-card")?.className).toContain(
      "grid-rows"
    );
    expect(hidden.getGridOptions()).toEqual({
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 2,
    });

    const open = createCard(
      {
        target,
        monitored_nodes_default_open: true,
        diagnostics_default_open: true,
      },
      hass
    );
    expect(
      open.shadowRoot!.querySelector<HTMLDetailsElement>(
        '[data-disclosure="monitored-nodes"]'
      )!.open
    ).toBe(true);
    expect(
      open.shadowRoot!.querySelector<HTMLDetailsElement>(
        '[data-disclosure="diagnostics"]'
      )!.open
    ).toBe(true);
    expect(shadowBody(open)).toContain(t("card.status_cumulative_note"));
  });

  it("preserves issue disclosure state across rerenders", () => {
    const hass = statusHass();
    hass.states[`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`]!.state = "40";
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_battery_percentage_test_hub`,
      20,
      HUB_DEVICE_ID,
      { unit_of_measurement: "%" }
    );
    const config = { target };
    const card = createCard(config, hass);
    let issue = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      '[data-disclosure="issue:low_battery"]'
    )!;
    issue.open = true;
    issue.dispatchEvent(new Event("toggle"));
    card.setConfig(config);
    issue = card.shadowRoot!.querySelector<HTMLDetailsElement>(
      '[data-disclosure="issue:low_battery"]'
    )!;
    expect(issue.open).toBe(true);
  });

  it("opens the hub from the Tile header and finding entities from rows", () => {
    const hass = statusHass();
    const battery = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[battery]!.state = "40";
    const card = createCard({ target }, hass);
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as CustomEvent<{ entityId: string }>).detail.entityId
      );
    });
    card.shadowRoot!.querySelector<HTMLButtonElement>(".device-header")!.click();
    card.shadowRoot!
      .querySelector<HTMLButtonElement>(`[data-entity="${battery}"]`)!
      .click();
    expect(seen).toEqual([HUB_STATUS_ENTITY, battery]);
  });

  it("escapes configured and registry-controlled text", () => {
    const hass = statusHass();
    hass.devices["hub-device"]!.name_by_user = '<img src=x onerror="boom">';
    const card = createCard(
      { target, name: '<script id="bad">boom</script>' },
      hass
    );
    const body = shadowBody(card);
    expect(body).toContain("&lt;script");
    expect(card.shadowRoot!.querySelector("script#bad")).toBeNull();
    expect(card.shadowRoot!.querySelector("img")).toBeNull();
  });

  it("cleans up scheduled rendering when removed", () => {
    vi.useFakeTimers();
    const card = createCard();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    card.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
