import { describe, expect, it } from "vitest";
import { MeshcoreChannelCardEditor } from "../src/channel-card.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HaFormElement,
  HaFormExpandableSchema,
  HaFormFieldSchema,
  HomeAssistant,
  MeshcoreChannelCardConfig,
} from "../src/types.js";
import { CHANNEL_ENTITY, createChannelHass, defineOnce, state } from "./fixtures.js";

defineOnce("mushroom-meshcore-channel-card-editor", MeshcoreChannelCardEditor);

const t = makeLocalize("en");

function createEditor(
  config: MeshcoreChannelCardConfig | null = {},
  hass: HomeAssistant | null = createChannelHass()
): { editor: MeshcoreChannelCardEditor; configs: MeshcoreChannelCardConfig[] } {
  const editor = document.createElement(
    "mushroom-meshcore-channel-card-editor"
  ) as MeshcoreChannelCardEditor;
  const configs: MeshcoreChannelCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => {
    configs.push(
      (event as CustomEvent<{ config: MeshcoreChannelCardConfig }>).detail.config
    );
  });
  if (config) editor.setConfig(config);
  if (hass) editor.hass = hass;
  return { editor, configs };
}

function forms(editor: HTMLElement): HaFormElement[] {
  return Array.from(editor.querySelectorAll("ha-form")) as HaFormElement[];
}

function changeValue(form: HaFormElement, value: Record<string, unknown>): void {
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
}

describe("MeshcoreChannelCardEditor", () => {
  it("renders nothing before setConfig, even when connected", () => {
    const { editor } = createEditor(null, null);
    document.body.appendChild(editor);
    expect(editor.children).toHaveLength(0);
    editor.remove();
  });

  it("re-renders from connectedCallback once configured", () => {
    const { editor } = createEditor();
    document.body.appendChild(editor);
    expect(forms(editor).length).toBeGreaterThan(0);
    editor.remove();
  });

  it("shows an info alert when no channel entities exist", () => {
    const { editor } = createEditor({}, null);
    expect(editor.querySelector("ha-alert")?.textContent).toBe(
      t("editor.no_channels_detected")
    );
  });

  it("offers discovered channel entities in the target picker", () => {
    const { editor } = createEditor();
    const [targetForm] = forms(editor);
    const field = targetForm!.schema[0] as HaFormFieldSchema;
    expect(field.label).toBe(t("editor.target_channel"));
    expect(field.selector.entity!.include_entities).toEqual([CHANNEL_ENTITY]);
    // No settings form until a channel is picked.
    expect(forms(editor)).toHaveLength(1);
  });

  it("labels form fields from the schema, falling back to the name", () => {
    const { editor } = createEditor({ entity: CHANNEL_ENTITY });
    const [targetForm, settingsForm] = forms(editor);
    expect(targetForm!.computeLabel(targetForm!.schema[0]!)).toBe(
      t("editor.target_channel")
    );
    for (const form of [targetForm!, settingsForm!]) {
      expect(form.computeLabel({ name: "bare", selector: {} })).toBe("bare");
    }
  });

  it("keeps forms in place across hass refreshes without discovery changes", () => {
    const { editor } = createEditor();
    const [before] = forms(editor);
    const nextHass = createChannelHass();
    editor.hass = nextHass;
    expect(forms(editor)[0]).toBe(before);
    expect(forms(editor)[0]!.hass).toBe(nextHass);
  });

  it("rebuilds when a new channel entity appears", () => {
    const { editor } = createEditor();
    const [before] = forms(editor);
    const hass = createChannelHass();
    const second = state("Active", { channel_index: 1 });
    second.entity_id = "binary_sensor.meshcore_edfaf6_ch_1_messages";
    hass.states[second.entity_id] = second;
    editor.hass = hass;
    expect(forms(editor)[0]).not.toBe(before);
  });

  it("skips the re-render when setConfig echoes the same config", () => {
    const { editor } = createEditor({ entity: CHANNEL_ENTITY });
    const [before] = forms(editor);
    editor.setConfig({ entity: CHANNEL_ENTITY });
    expect(forms(editor)[0]).toBe(before);
  });

  it("stores the selected channel and reveals the settings form", () => {
    const { editor, configs } = createEditor();
    changeValue(forms(editor)[0]!, { entity: CHANNEL_ENTITY });
    expect(configs[configs.length - 1]?.entity).toBe(CHANNEL_ENTITY);
    expect(forms(editor)).toHaveLength(2);
  });

  it("clears the channel when the picker empties", () => {
    const { editor, configs } = createEditor({ entity: CHANNEL_ENTITY });
    changeValue(forms(editor)[0]!, { entity: "" });
    expect(configs[configs.length - 1]?.entity).toBeUndefined();
    expect(forms(editor)).toHaveLength(1);
  });

  it("presents appearance, interactions, and history sections with defaults", () => {
    const { editor } = createEditor({ entity: CHANNEL_ENTITY });
    const settings = forms(editor)[1]!;
    const schema = settings.schema as HaFormExpandableSchema[];
    expect(schema.map((section) => section.title)).toEqual([
      t("editor.section_appearance"),
      t("editor.section_interactions"),
      t("editor.section_history"),
    ]);
    expect(settings.data["hours_to_show"]).toBe(24);
    expect(settings.data["max_messages"]).toBe(200);
    expect(settings.data["hide_timestamps"]).toBe(false);
    expect(settings.data["hide_route_details"]).toBe(false);
    const appearance = schema[0]!.schema;
    expect(
      appearance.find((field) => field.name === "hide_route_details")?.label
    ).toBe(t("editor.hide_route_details"));
  });

  it("normalizes settings edits into a minimal config", () => {
    const { editor, configs } = createEditor({ entity: CHANNEL_ENTITY });
    changeValue(forms(editor)[1]!, {
      name: "Mesh Chat",
      icon: "   ",
      icon_color: "green",
      hide_timestamps: true,
      hide_route_details: true,
      hide_date_headers: false,
      tap_action: { action: "url", url_path: "https://example.com" },
      hold_action: "invalid",
      hours_to_show: 48,
      max_messages: 20.7,
    });
    const config = configs[configs.length - 1]!;
    expect(config.entity).toBe(CHANNEL_ENTITY);
    expect(config.name).toBe("Mesh Chat");
    expect(config.icon).toBeUndefined();
    expect(config.icon_color).toBe("green");
    expect(config.hide_timestamps).toBe(true);
    expect(config.hide_route_details).toBe(true);
    expect(config.hide_date_headers).toBeUndefined();
    expect(config.tap_action).toEqual({
      action: "url",
      url_path: "https://example.com",
    });
    expect(config.hold_action).toBeUndefined();
    expect(config.hours_to_show).toBe(48);
    expect(config.max_messages).toBe(20);
  });

  it("drops history settings equal to the defaults", () => {
    const { editor, configs } = createEditor({
      entity: CHANNEL_ENTITY,
      hours_to_show: 48,
      max_messages: 20,
    });
    changeValue(forms(editor)[1]!, {
      hours_to_show: 24,
      max_messages: 200,
    });
    const config = configs[configs.length - 1]!;
    expect(config.hours_to_show).toBeUndefined();
    expect(config.max_messages).toBeUndefined();
  });

  it("rejects out-of-range history values", () => {
    const { editor, configs } = createEditor({
      entity: CHANNEL_ENTITY,
      hours_to_show: 48,
      max_messages: 20,
    });
    changeValue(forms(editor)[1]!, {
      hours_to_show: 0,
      max_messages: "many",
    });
    const config = configs[configs.length - 1]!;
    expect(config.hours_to_show).toBeUndefined();
    expect(config.max_messages).toBeUndefined();
  });
});
