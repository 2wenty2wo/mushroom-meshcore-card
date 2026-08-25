import { describe, expect, it } from "vitest";
import { MeshcoreCardEditor } from "../src/editor.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HaFormElement,
  HaFormExpandableSchema,
  HaFormFieldSchema,
  HomeAssistant,
  MeshcoreCardConfig,
} from "../src/types.js";
import {
  HUB_PUBKEY,
  NODE_NAME,
  createHass,
  defineOnce,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card-editor", MeshcoreCardEditor);

const t = makeLocalize("en");

const NODE_TARGET = { type: "node", id: NODE_NAME } as const;
const HUB_TARGET = { type: "hub", id: HUB_PUBKEY } as const;

function createEditor(
  config: MeshcoreCardConfig = {},
  hass: HomeAssistant | null = createHass()
): { editor: MeshcoreCardEditor; configs: MeshcoreCardConfig[] } {
  const editor = document.createElement(
    "mushroom-meshcore-card-editor"
  ) as MeshcoreCardEditor;
  const configs: MeshcoreCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => {
    configs.push(
      (event as CustomEvent<{ config: MeshcoreCardConfig }>).detail.config
    );
  });
  editor.setConfig(config);
  if (hass) editor.hass = hass;
  return { editor, configs };
}

function forms(editor: HTMLElement): HaFormElement[] {
  return Array.from(editor.querySelectorAll("ha-form")) as HaFormElement[];
}

function changeValue(
  form: HaFormElement,
  value: Record<string, unknown>
): void {
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
}

function sections(form: HaFormElement): HaFormExpandableSchema[] {
  return form.schema as HaFormExpandableSchema[];
}

function fieldNames(section: HaFormExpandableSchema): string[] {
  return section.schema.map((field) => field.name);
}

function selectTarget(form: HaFormElement, target: unknown): void {
  changeValue(form, { target });
}

describe("MeshcoreCardEditor discovery", () => {
  it("shows an info alert before any hass object arrives", () => {
    const { editor } = createEditor({}, null);
    const alert = editor.querySelector("ha-alert");
    expect(alert?.textContent).toBe(t("editor.no_devices_detected"));
    expect(forms(editor)).toHaveLength(0);
  });

  it("shows the alert when hass exposes no MeshCore devices", () => {
    const empty = {
      ...createHass(),
      states: {},
      entities: {},
      devices: {},
    };
    const { editor } = createEditor({}, empty);
    expect(editor.querySelector("ha-alert")).not.toBeNull();
  });

  it("offers every discovered hub and node as a target option", () => {
    const { editor } = createEditor();
    const [targetForm] = forms(editor);
    const field = targetForm!.schema[0] as HaFormFieldSchema;
    expect(field.label).toBe(t("editor.target_device"));
    const options = field.selector.select!.options;
    expect(options.map((option) => option.label)).toEqual([
      t("editor.target_hub", { name: "test hub", id: HUB_PUBKEY }),
      t("editor.target_node", { name: NODE_NAME }),
    ]);
    expect(JSON.parse(options[0]!.value)).toEqual(HUB_TARGET);
    expect(JSON.parse(options[1]!.value)).toEqual(NODE_TARGET);
  });

  it("only renders the target form until a target is chosen", () => {
    const { editor } = createEditor();
    expect(forms(editor)).toHaveLength(1);
    const configured = createEditor({ target: NODE_TARGET });
    expect(forms(configured.editor)).toHaveLength(2);
  });

  it("keeps existing forms when hass updates without discovery changes", () => {
    const { editor } = createEditor();
    const [before] = forms(editor);
    const nextHass = createHass();
    editor.hass = nextHass;
    const [after] = forms(editor);
    expect(after).toBe(before);
    expect(after!.hass).toBe(nextHass);
  });

  it("rebuilds the editor when a new hub appears", () => {
    const { editor } = createEditor();
    const [before] = forms(editor);
    editor.hass = createHass({
      extraStates: {
        "sensor.meshcore_ab12cd_node_count_second_hub": state(1),
      },
    });
    const [after] = forms(editor);
    expect(after).not.toBe(before);
    const field = after!.schema[0] as HaFormFieldSchema;
    expect(field.selector.select!.options).toHaveLength(3);
  });

  it("skips the teardown re-render when setConfig echoes the same config", () => {
    const { editor } = createEditor({ target: NODE_TARGET });
    const [before] = forms(editor);
    editor.setConfig({ target: { ...NODE_TARGET } });
    expect(forms(editor)[0]).toBe(before);
    editor.setConfig({ target: { ...NODE_TARGET }, name: "Renamed" });
    expect(forms(editor)[0]).not.toBe(before);
  });
});

describe("MeshcoreCardEditor target selection", () => {
  it("dispatches the chosen target and reveals the settings form", () => {
    const { editor, configs } = createEditor();
    selectTarget(forms(editor)[0]!, JSON.stringify(NODE_TARGET));
    expect(configs[configs.length - 1]?.target).toEqual(NODE_TARGET);
    expect(forms(editor)).toHaveLength(2);
  });

  it("clears device-specific settings when the target changes", () => {
    const { editor, configs } = createEditor({
      target: HUB_TARGET,
      name: "My hub",
      hide_battery: true,
      battery_entity: "sensor.batt",
      map_metro: "smf",
    });
    selectTarget(forms(editor)[0]!, JSON.stringify(NODE_TARGET));
    const config = configs[configs.length - 1]!;
    expect(config.target).toEqual(NODE_TARGET);
    expect(config.name).toBeUndefined();
    expect(config.hide_battery).toBeUndefined();
    expect(config.battery_entity).toBeUndefined();
    // map_metro is not device-specific and survives the switch.
    expect(config.map_metro).toBe("smf");
  });

  it("keeps settings when the same target is re-selected", () => {
    const { editor, configs } = createEditor({
      target: NODE_TARGET,
      name: "Farm Link",
    });
    selectTarget(forms(editor)[0]!, JSON.stringify(NODE_TARGET));
    expect(configs[configs.length - 1]?.name).toBe("Farm Link");
  });

  it("treats malformed select values as clearing the target", () => {
    for (const bad of [
      "not json",
      "",
      42,
      JSON.stringify({ type: "gateway", id: "x" }),
      JSON.stringify({ type: "hub" }),
      JSON.stringify({ type: "node", id: "" }),
    ]) {
      const { editor, configs } = createEditor({ target: NODE_TARGET });
      selectTarget(forms(editor)[0]!, bad);
      expect(configs[configs.length - 1]?.target).toBeUndefined();
    }
  });

  it("strips legacy hubs/nodes fields from dispatched configs", () => {
    const legacyConfig = {
      target: NODE_TARGET,
      hubs: [],
      nodes: [],
      nodes_order: [],
    } as MeshcoreCardConfig;
    const { editor, configs } = createEditor(legacyConfig);
    selectTarget(forms(editor)[0]!, JSON.stringify(NODE_TARGET));
    const config = configs[configs.length - 1] as Record<string, unknown>;
    expect(config["hubs"]).toBeUndefined();
    expect(config["nodes"]).toBeUndefined();
    expect(config["nodes_order"]).toBeUndefined();
  });
});

describe("MeshcoreCardEditor settings schema", () => {
  it("builds the node schema with entity overrides and neighbor options", () => {
    const { editor } = createEditor({ target: NODE_TARGET });
    const settings = forms(editor)[1]!;
    const schema = sections(settings);
    expect(schema.map((section) => section.title)).toEqual([
      t("editor.section_appearance"),
      t("editor.section_interactions"),
      t("editor.section_entities"),
      t("editor.section_behavior"),
    ]);
    expect(fieldNames(schema[0]!)).toContain("hide_metrics");
    expect(fieldNames(schema[0]!)).toContain("show_firmware");
    expect(fieldNames(schema[2]!)).toEqual([
      "battery_entity",
      "voltage_entity",
      "location_entity",
      "temperature_entity",
      "humidity_entity",
      "illuminance_entity",
      "pressure_entity",
    ]);
    expect(fieldNames(schema[3]!)).toEqual([
      "show_neighbors",
      "max_neighbors",
      "map_provider",
      "map_metro",
    ]);
    // Device-scoped entities restrict the pickers to that node's entities.
    const battery = schema[2]!.schema[0]!;
    expect(battery.selector.entity!.include_entities).toContain(
      "sensor.meshcore_spring_battery_percentage_spring_farm"
    );
    // The settings form starts from the current config's data.
    expect(settings.data["show_neighbors"]).toBe(true);
    expect(settings.data["map_provider"]).toBe("analyzer");
  });

  it("builds the hub schema without node-only fields", () => {
    const { editor } = createEditor({ target: HUB_TARGET });
    const schema = sections(forms(editor)[1]!);
    expect(schema.map((section) => section.title)).toEqual([
      t("editor.section_appearance"),
      t("editor.section_interactions"),
      t("editor.section_entities"),
      t("editor.section_map"),
    ]);
    expect(fieldNames(schema[0]!)).not.toContain("hide_metrics");
    expect(fieldNames(schema[2]!)).toEqual(["battery_entity", "voltage_entity"]);
    expect(fieldNames(schema[3]!)).toEqual(["map_provider", "map_metro"]);
  });

  it("falls back to domain-wide entity pickers for an unresolved node", () => {
    const { editor } = createEditor({
      target: { type: "node", id: "Ghost Node" },
    });
    const schema = sections(forms(editor)[1]!);
    const battery = schema[2]!.schema[0]!;
    expect(battery.selector.entity!.include_entities).toBeUndefined();
    expect(battery.selector.entity!.domain).toBe("sensor");
  });

  it("falls back to domain-wide entity pickers for an unresolved hub", () => {
    const { editor } = createEditor({ target: { type: "hub", id: "beef00" } });
    const schema = sections(forms(editor)[1]!);
    const battery = schema[2]!.schema[0]!;
    expect(battery.selector.entity!.include_entities).toBeUndefined();
    expect(battery.selector.entity!.domain).toBe("sensor");
  });

  it("copes with a hass object that has no entity registry", () => {
    const registryless = {
      ...createHass(),
      entities: undefined,
    } as unknown as HomeAssistant;
    const { editor } = createEditor({ target: NODE_TARGET }, registryless);
    const schema = sections(forms(editor)[1]!);
    const location = schema[2]!.schema[2]!;
    expect(location.name).toBe("location_entity");
    expect(location.selector.entity!.domain).toBe("sensor");
  });
});

describe("MeshcoreCardEditor settings edits", () => {
  function editNodeSettings(
    initial: MeshcoreCardConfig,
    value: Record<string, unknown>
  ): MeshcoreCardConfig {
    const { editor, configs } = createEditor(initial);
    changeValue(forms(editor)[1]!, value);
    return configs[configs.length - 1]!;
  }

  it("normalizes edits into a minimal config", () => {
    const config = editNodeSettings(
      { target: NODE_TARGET },
      {
        name: "   ",
        icon: "mdi:antenna",
        icon_color: "green",
        hide_battery: true,
        hide_metrics: false,
        battery_entity: "sensor.batt",
        voltage_entity: "",
        tap_action: { action: "navigate", navigation_path: "/x" },
        hold_action: { action: 5 },
        show_neighbors: false,
        max_neighbors: 3,
        map_provider: "meshmapper",
        map_metro: " smf ",
      }
    );
    expect(config.name).toBeUndefined();
    expect(config.icon).toBe("mdi:antenna");
    expect(config.icon_color).toBe("green");
    expect(config.hide_battery).toBe(true);
    expect(config.hide_metrics).toBeUndefined();
    expect(config.battery_entity).toBe("sensor.batt");
    expect(config.voltage_entity).toBeUndefined();
    expect(config.tap_action).toEqual({
      action: "navigate",
      navigation_path: "/x",
    });
    expect(config.hold_action).toBeUndefined();
    expect(config.show_neighbors).toBe(false);
    expect(config.max_neighbors).toBe(3);
    expect(config.map_provider).toBe("meshmapper");
    expect(config.map_metro).toBe("smf");
  });

  it("drops defaults so the stored config stays clean", () => {
    const config = editNodeSettings(
      {
        target: NODE_TARGET,
        show_neighbors: false,
        max_neighbors: 5,
        map_provider: "meshmapper",
        map_metro: "smf",
      },
      {
        show_neighbors: true,
        max_neighbors: 0,
        map_provider: "analyzer",
        map_metro: "   ",
      }
    );
    expect(config.show_neighbors).toBeUndefined();
    expect(config.max_neighbors).toBeUndefined();
    expect(config.map_provider).toBeUndefined();
    expect(config.map_metro).toBeUndefined();
  });

  it("never stores neighbor settings for hub targets", () => {
    const { editor, configs } = createEditor({ target: HUB_TARGET });
    changeValue(forms(editor)[1]!, {
      show_neighbors: false,
      max_neighbors: 4,
    });
    const config = configs[configs.length - 1]!;
    expect(config.show_neighbors).toBeUndefined();
    expect(config.max_neighbors).toBeUndefined();
  });
});
