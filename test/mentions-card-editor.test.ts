import { describe, expect, it } from "vitest";
import { MeshcoreMentionsCardEditor } from "../src/mentions-card.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HaFormElement,
  HaFormExpandableSchema,
  HaFormFieldSchema,
  HomeAssistant,
  MeshcoreMentionsCardConfig,
} from "../src/types.js";
import { createHass, defineOnce, state } from "./fixtures.js";

defineOnce(
  "mushroom-meshcore-mentions-card-editor",
  MeshcoreMentionsCardEditor
);

const TODO_ENTITY = "todo.meshcore_tags";
const SECOND_TODO_ENTITY = "todo.archive_mentions";
const t = makeLocalize("en");

function createEditorHass(entityIds = [TODO_ENTITY]): HomeAssistant {
  const hass = createHass();
  for (const entityId of entityIds) {
    const todo = state("0", {
      friendly_name: entityId,
      supported_features: 4,
    });
    todo.entity_id = entityId;
    hass.states[entityId] = todo;
  }
  return hass;
}

function createEditor(
  config: MeshcoreMentionsCardConfig | null = {},
  hass: HomeAssistant | null = createEditorHass()
): {
  editor: MeshcoreMentionsCardEditor;
  configs: MeshcoreMentionsCardConfig[];
} {
  const editor = document.createElement(
    "mushroom-meshcore-mentions-card-editor"
  ) as MeshcoreMentionsCardEditor;
  const configs: MeshcoreMentionsCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => {
    configs.push(
      (event as CustomEvent<{ config: MeshcoreMentionsCardConfig }>).detail
        .config
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

describe("MeshcoreMentionsCardEditor", () => {
  it("renders nothing before setConfig, including when connected", () => {
    const { editor } = createEditor(null, null);
    document.body.appendChild(editor);
    expect(editor.children).toHaveLength(0);
    editor.remove();
  });

  it("renders from connectedCallback once configured", () => {
    const { editor } = createEditor({}, null);
    document.body.appendChild(editor);
    expect(editor.querySelector("ha-alert")?.textContent).toBe(
      t("editor.no_todo_entities")
    );
    editor.remove();
  });

  it("shows an alert when no todo entities are available", () => {
    const { editor } = createEditor({}, createHass());
    const alert = editor.querySelector("ha-alert") as HTMLElement & {
      alertType: string;
    };
    expect(alert.textContent).toBe(t("editor.no_todo_entities"));
    expect(alert.alertType).toBe("info");
    expect(forms(editor)).toHaveLength(0);
  });

  it("offers only sorted todo entities and never selects one implicitly", () => {
    const hass = createEditorHass([TODO_ENTITY, SECOND_TODO_ENTITY]);
    const wrongDomain = state("0");
    wrongDomain.entity_id = "sensor.meshcore_tags";
    hass.states[wrongDomain.entity_id] = wrongDomain;
    const uppercase = state("0");
    uppercase.entity_id = "todo.Invalid";
    hass.states[uppercase.entity_id] = uppercase;

    const { editor } = createEditor({}, hass);
    const [target] = forms(editor);
    const field = target!.schema[0] as HaFormFieldSchema;
    expect(field.label).toBe(t("editor.target_mentions"));
    expect(field.selector.entity).toEqual({
      domain: "todo",
      include_entities: [SECOND_TODO_ENTITY, TODO_ENTITY],
    });
    expect(target!.data).toEqual({ entity: null });
    expect(forms(editor)).toHaveLength(1);
  });

  it("labels fields from localized schema and falls back to field names", () => {
    const { editor } = createEditor({ entity: TODO_ENTITY });
    const [target, settings] = forms(editor);
    expect(target!.computeLabel(target!.schema[0]!)).toBe(
      t("editor.target_mentions")
    );
    const appearance = settings!.schema[0] as HaFormExpandableSchema;
    expect(settings!.computeLabel(appearance.schema[0]!)).toBe(
      t("editor.name_label")
    );
    for (const form of [target!, settings!]) {
      expect(form.computeLabel({ name: "bare", selector: {} })).toBe("bare");
      expect(
        form.computeLabel({ name: "fallback", label: undefined, selector: {} })
      ).toBe("fallback");
    }
  });

  it("falls back through the hass locale and then English", () => {
    const germanHass = createEditorHass();
    germanHass.language = undefined as never;
    germanHass.locale.language = "de";
    const german = createEditor({}, germanHass).editor;
    expect(
      (forms(german)[0]!.schema[0] as HaFormFieldSchema).label
    ).toBe(makeLocalize("de")("editor.target_mentions"));

    const fallbackHass = createHass();
    fallbackHass.language = undefined as never;
    fallbackHass.locale = undefined as never;
    const fallback = createEditor({}, fallbackHass).editor;
    expect(fallback.querySelector("ha-alert")?.textContent).toBe(
      t("editor.no_todo_entities")
    );
  });

  it("preserves form identity across unchanged hass and config echoes", () => {
    const config = {
      entity: TODO_ENTITY,
      grid_options: { columns: "full" as const, rows: 6 },
    };
    const { editor } = createEditor(config);
    const [target, settings] = forms(editor);
    const refreshedHass = createEditorHass();
    editor.hass = refreshedHass;
    expect(forms(editor)[0]).toBe(target);
    expect(forms(editor)[1]).toBe(settings);
    expect(target!.hass).toBe(refreshedHass);

    editor.setConfig(config);
    expect(forms(editor)[0]).toBe(target);
    expect(forms(editor)[1]).toBe(settings);
  });

  it("rebuilds the picker when todo discovery changes", () => {
    const { editor } = createEditor({});
    const [before] = forms(editor);
    editor.hass = createEditorHass([TODO_ENTITY, SECOND_TODO_ENTITY]);
    expect(forms(editor)[0]).not.toBe(before);
  });

  it("sets and clears the explicit entity while preserving unrelated config", () => {
    const { editor, configs } = createEditor({
      type: "custom:mushroom-meshcore-mentions-card",
      name: "Radio Mentions",
      grid_options: { columns: "full", rows: 6 },
    });
    changeValue(forms(editor)[0]!, { entity: TODO_ENTITY });
    expect(configs[configs.length - 1]).toEqual({
      type: "custom:mushroom-meshcore-mentions-card",
      entity: TODO_ENTITY,
      name: "Radio Mentions",
      grid_options: { columns: "full", rows: 6 },
    });
    expect(forms(editor)).toHaveLength(2);

    changeValue(forms(editor)[0]!, { entity: "" });
    expect(configs[configs.length - 1]?.entity).toBeUndefined();
    expect(configs[configs.length - 1]?.grid_options).toEqual({
      columns: "full",
      rows: 6,
    });
    expect(forms(editor)).toHaveLength(1);
  });

  it("presents Appearance, Interactions, and Mentions sections with defaults", () => {
    const { editor } = createEditor({ entity: TODO_ENTITY });
    const settings = forms(editor)[1]!;
    const schema = settings.schema as HaFormExpandableSchema[];
    expect(schema.map((section) => section.title)).toEqual([
      t("editor.section_appearance"),
      t("editor.section_interactions"),
      t("editor.section_mentions_behavior"),
    ]);
    expect(schema.map((section) => section.icon)).toEqual([
      "mdi:palette",
      "mdi:gesture-tap",
      "mdi:format-list-checks",
    ]);
    expect(settings.data).toEqual({
      name: "",
      icon: null,
      icon_color: null,
      tap_action: undefined,
      hold_action: undefined,
      double_tap_action: undefined,
      hide_completed: true,
      hide_timestamps: false,
      hide_date_headers: false,
      hide_links: false,
    });
    expect(schema[2]!.schema.map((field) => field.name)).toEqual([
      "hide_completed",
      "hide_timestamps",
      "hide_date_headers",
      "hide_links",
    ]);
    expect(schema[2]!.schema.map((field) => field.label)).toEqual([
      t("editor.hide_completed_mentions"),
      t("editor.hide_timestamps"),
      t("editor.hide_date_headers"),
      t("editor.hide_links"),
    ]);
  });

  it("normalizes appearance, action, and behavior changes", () => {
    const { editor, configs } = createEditor({
      entity: TODO_ENTITY,
      icon: "mdi:at",
      hold_action: { action: "none" },
      grid_options: { columns: "full", rows: 5 },
    });
    changeValue(forms(editor)[1]!, {
      name: "Radio Mentions",
      icon: "   ",
      icon_color: "orange",
      tap_action: { action: "more-info" },
      hold_action: "invalid",
      double_tap_action: { action: "url", url_path: "https://example.com" },
      hide_completed: false,
      hide_timestamps: true,
      hide_date_headers: false,
      hide_links: true,
    });
    expect(configs[configs.length - 1]).toEqual({
      entity: TODO_ENTITY,
      name: "Radio Mentions",
      icon_color: "orange",
      tap_action: { action: "more-info" },
      double_tap_action: { action: "url", url_path: "https://example.com" },
      hide_completed: false,
      hide_timestamps: true,
      hide_links: true,
      grid_options: { columns: "full", rows: 5 },
    });
  });

  it("removes optional settings when values return to defaults", () => {
    const { editor, configs } = createEditor({
      entity: TODO_ENTITY,
      name: "Old",
      icon: "mdi:at",
      icon_color: "orange",
      tap_action: { action: "more-info" },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
      hide_completed: false,
      hide_timestamps: true,
      hide_date_headers: true,
      hide_links: true,
    });
    changeValue(forms(editor)[1]!, {
      name: null,
      icon: "",
      icon_color: undefined,
      tap_action: null,
      hold_action: {},
      double_tap_action: false,
      hide_completed: true,
      hide_timestamps: false,
      hide_date_headers: false,
      hide_links: false,
    });
    expect(configs[configs.length - 1]).toEqual({ entity: TODO_ENTITY });
  });
});
