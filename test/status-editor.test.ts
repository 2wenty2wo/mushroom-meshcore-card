import { describe, expect, it } from "vitest";
import {
  MeshcoreStatusBadgeEditor,
  MeshcoreStatusCardEditor,
} from "../src/status-editor.js";
import type {
  HaFormElement,
  HaFormExpandableSchema,
  HaFormFieldSchema,
  HomeAssistant,
  MeshcoreStatusBadgeConfig,
  MeshcoreStatusCardConfig,
} from "../src/types.js";
import {
  HUB_PUBKEY,
  createHass,
  defineOnce,
  device,
  registryEntry,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-status-card-editor", MeshcoreStatusCardEditor);
defineOnce("mushroom-meshcore-status-badge-editor", MeshcoreStatusBadgeEditor);

type AnyStatusConfig = MeshcoreStatusCardConfig | MeshcoreStatusBadgeConfig;

function createEditor<T extends AnyStatusConfig>(
  tag: "mushroom-meshcore-status-card-editor" | "mushroom-meshcore-status-badge-editor",
  config: T,
  hass: HomeAssistant = createHass()
): { editor: HTMLElement; configs: T[] } {
  const editor = document.createElement(tag);
  const configs: T[] = [];
  editor.addEventListener("config-changed", (event) => {
    configs.push((event as CustomEvent<{ config: T }>).detail.config);
  });
  (editor as MeshcoreStatusCardEditor | MeshcoreStatusBadgeEditor).setConfig(
    config
  );
  (editor as MeshcoreStatusCardEditor | MeshcoreStatusBadgeEditor).hass = hass;
  return { editor, configs };
}

function forms(editor: HTMLElement): HaFormElement[] {
  return Array.from(editor.querySelectorAll("ha-form")) as HaFormElement[];
}

function targetForm(editor: HTMLElement): HaFormElement {
  return forms(editor)[0]!;
}

function settingsForm(editor: HTMLElement): HaFormElement {
  return forms(editor).find(
    (form) =>
      (form.schema[0] as Partial<HaFormExpandableSchema> | undefined)?.type ===
      "expandable"
  )!;
}

function change(form: HaFormElement, value: Record<string, unknown>): void {
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
}

function flattenedFields(form: HaFormElement): HaFormFieldSchema[] {
  return form.schema.flatMap((entry) =>
    (entry as Partial<HaFormExpandableSchema>).type === "expandable"
      ? (entry as HaFormExpandableSchema).schema
      : [entry as HaFormFieldSchema]
  );
}

describe("Status visual editors", () => {
  it("renders only a hub target selector until a target is chosen", () => {
    const { editor } = createEditor(
      "mushroom-meshcore-status-card-editor",
      {}
    );
    expect(forms(editor)).toHaveLength(1);
    const field = targetForm(editor).schema[0] as HaFormFieldSchema;
    expect(field.name).toBe("target");
    expect(field.selector.select?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: HUB_PUBKEY }),
      ])
    );
  });

  it("shows all shared and card-only fields with the correct hub entities", () => {
    const { editor } = createEditor(
      "mushroom-meshcore-status-card-editor",
      { target: { type: "hub", id: HUB_PUBKEY } }
    );
    const form = settingsForm(editor);
    const fields = flattenedFields(form);
    const names = fields.map((field) => field.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "name",
        "icon",
        "icon_color",
        "tap_action",
        "hold_action",
        "double_tap_action",
        "status_entity",
        "battery_entity",
        "low_battery_threshold",
        "excluded_nodes",
        "hide_monitored_nodes",
        "monitored_nodes_default_open",
        "hide_diagnostics",
        "diagnostics_default_open",
      ])
    );
    const statusField = fields.find((field) => field.name === "status_entity")!;
    expect(statusField.selector.entity?.include_entities).toContain(
      `sensor.meshcore_${HUB_PUBKEY}_node_status_test_hub`
    );
    expect(form.data["low_battery_threshold"]).toBe(50);
    const exclusions = fields.find((field) => field.name === "excluded_nodes")!;
    expect(exclusions.selector.select?.options).toContainEqual({
      value: "Spring Farm",
      label: "Spring Farm",
    });
  });

  it("keeps the badge editor compact and leaves omitted tap_action undefined", () => {
    const { editor, configs } = createEditor(
      "mushroom-meshcore-status-badge-editor",
      { target: { type: "hub", id: HUB_PUBKEY } }
    );
    const form = settingsForm(editor);
    const fields = flattenedFields(form);
    expect(fields.some((field) => field.name === "hide_diagnostics")).toBe(false);
    const tapAction = fields.find((field) => field.name === "tap_action")!;
    expect(tapAction.label).toBe("Tap action (default: status details)");
    expect(tapAction.selector.ui_action?.default_action).toBeUndefined();
    expect(form.data["tap_action"]).toBeUndefined();
    change(form, {
      ...form.data,
      low_battery_threshold: 40,
    });
    expect(configs[configs.length - 1]).toEqual({
      target: { type: "hub", id: HUB_PUBKEY },
      low_battery_threshold: 40,
    });
  });

  it("rejects cleared threshold values while preserving an explicit zero", () => {
    const { editor, configs } = createEditor(
      "mushroom-meshcore-status-card-editor",
      {
        target: { type: "hub", id: HUB_PUBKEY },
        low_battery_threshold: 35,
      }
    );
    const form = settingsForm(editor);

    for (const threshold of [null, "", "   ", true, false] as const) {
      change(form, {
        ...form.data,
        low_battery_threshold: threshold,
      });
      expect(configs[configs.length - 1]).toEqual({
        target: { type: "hub", id: HUB_PUBKEY },
      });
    }

    for (const threshold of [0, "0"] as const) {
      change(form, {
        ...form.data,
        low_battery_threshold: threshold,
      });
      expect(configs[configs.length - 1]).toEqual({
        target: { type: "hub", id: HUB_PUBKEY },
        low_battery_threshold: 0,
      });
    }
  });

  it("round-trips settings while omitting defaults and preserving unrelated config", () => {
    const { editor, configs } = createEditor(
      "mushroom-meshcore-status-card-editor",
      {
        type: "custom:mushroom-meshcore-status-card",
        target: { type: "hub", id: HUB_PUBKEY },
        grid_options: { rows: 4, columns: "full" },
      }
    );
    const form = settingsForm(editor);
    change(form, {
      ...form.data,
      name: " East Hub ",
      icon: "mdi:antenna",
      low_battery_threshold: 50,
      excluded_nodes: ["Spring Farm", "Spring Farm", ""],
      hide_diagnostics: true,
      tap_action: { action: "more-info" },
    });
    expect(configs[configs.length - 1]).toEqual({
      type: "custom:mushroom-meshcore-status-card",
      target: { type: "hub", id: HUB_PUBKEY },
      grid_options: { rows: 4, columns: "full" },
      name: "East Hub",
      icon: "mdi:antenna",
      excluded_nodes: ["Spring Farm"],
      hide_diagnostics: true,
      tap_action: { action: "more-info" },
    });
  });

  it("clears hub-scoped exclusions and overrides on target switch only", () => {
    const hass = createHass();
    const secondId = "second-hub";
    const secondPubkey = "abc123";
    hass.devices[secondId] = device(secondId, { name: "Second Hub" });
    const count = `sensor.meshcore_${secondPubkey}_node_count_second`;
    const status = `sensor.meshcore_${secondPubkey}_node_status_second`;
    for (const [entityId, value] of [[count, 1], [status, "online"]] as const) {
      const entityState = state(value);
      entityState.entity_id = entityId;
      hass.states[entityId] = entityState;
      const entry = registryEntry(secondId);
      entry.entity_id = entityId;
      hass.entities[entityId] = entry;
    }
    const { editor, configs } = createEditor(
      "mushroom-meshcore-status-card-editor",
      {
        target: { type: "hub", id: HUB_PUBKEY },
        excluded_nodes: ["Spring Farm"],
        status_entity: "sensor.custom_status",
        battery_entity: "sensor.custom_battery",
        low_battery_threshold: 35,
        name: "Fleet",
        diagnostics_default_open: true,
      },
      hass
    );
    change(targetForm(editor), { target: secondPubkey });
    expect(configs[configs.length - 1]).toEqual({
      target: { type: "hub", id: secondPubkey },
      low_battery_threshold: 35,
      name: "Fleet",
      diagnostics_default_open: true,
    });
  });

  it("warns that duplicate names are exclusion-wide", () => {
    const hass = createHass();
    const duplicateId = "duplicate-node";
    hass.devices[duplicateId] = device(duplicateId, {
      name: "Spring Farm",
      via_device_id: "hub-device",
    });
    const entityId = "sensor.meshcore_duplicate_uptime_spring_farm";
    const entityState = state(1);
    entityState.entity_id = entityId;
    hass.states[entityId] = entityState;
    const entry = registryEntry(duplicateId);
    entry.entity_id = entityId;
    hass.entities[entityId] = entry;
    const { editor } = createEditor(
      "mushroom-meshcore-status-card-editor",
      { target: { type: "hub", id: HUB_PUBKEY } },
      hass
    );
    const warning = Array.from(editor.querySelectorAll("ha-alert")).find(
      (alert) => alert.textContent?.includes("Spring Farm")
    ) as HTMLElement & { alertType: string };
    expect(warning).toBeDefined();
    expect(warning.alertType).toBe("warning");
  });

  it("does not rebuild forms when Home Assistant echoes identical config", () => {
    const config: MeshcoreStatusCardConfig = {
      target: { type: "hub", id: HUB_PUBKEY },
    };
    const { editor } = createEditor(
      "mushroom-meshcore-status-card-editor",
      config
    );
    const before = settingsForm(editor);
    (editor as MeshcoreStatusCardEditor).setConfig({ ...config });
    expect(settingsForm(editor)).toBe(before);
  });
});
