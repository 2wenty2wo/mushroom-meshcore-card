import { describe, expect, it } from "vitest";
import { MeshcoreReleasesCardEditor } from "../src/releases-card.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HaFormElement,
  HaFormExpandableSchema,
  HaFormFieldSchema,
  HomeAssistant,
  MeshcoreReleasesCardConfig,
} from "../src/types.js";
import { createHass, defineOnce, state } from "./fixtures.js";

defineOnce(
  "mushroom-meshcore-releases-card-editor",
  MeshcoreReleasesCardEditor
);

const FIRST = "sensor.meshcore_latest_release";
const SECOND = "sensor.mishmesh_latest_release";
const THIRD = "sensor.zephcore_latest_release";
const t = makeLocalize("en");

function editorHass(entityIds = [FIRST, SECOND, THIRD]): HomeAssistant {
  const hass = createHass();
  for (const entityId of entityIds) {
    const entityState = state("v1", { friendly_name: entityId });
    entityState.entity_id = entityId;
    hass.states[entityId] = entityState;
  }
  return hass;
}

function createEditor(
  config: MeshcoreReleasesCardConfig | null = { sources: [] },
  hass: HomeAssistant | null = editorHass()
): {
  editor: MeshcoreReleasesCardEditor;
  configs: MeshcoreReleasesCardConfig[];
} {
  const editor = document.createElement(
    "mushroom-meshcore-releases-card-editor"
  ) as MeshcoreReleasesCardEditor;
  const configs: MeshcoreReleasesCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => {
    configs.push(
      (event as CustomEvent<{ config: MeshcoreReleasesCardConfig }>).detail.config
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

function settingsForm(editor: HTMLElement): HaFormElement {
  return forms(editor).find(
    (form) => (form.schema[0] as Partial<HaFormExpandableSchema> | undefined)?.type === "expandable"
  )!;
}

function lastConfig(configs: MeshcoreReleasesCardConfig[]): MeshcoreReleasesCardConfig | undefined {
  return configs[configs.length - 1];
}

describe("MeshcoreReleasesCardEditor", () => {
  it("renders nothing until both config and hass are available", () => {
    const { editor } = createEditor(null, null);
    document.body.appendChild(editor);
    expect(editor.children).toHaveLength(0);
    editor.setConfig({ sources: [] });
    expect(editor.children).toHaveLength(0);
  });

  it("shows an informational alert when no sensor entities exist", () => {
    const hass = createHass();
    hass.states = {};
    const { editor } = createEditor({ sources: [] }, hass);
    const alert = editor.querySelector("ha-alert") as HTMLElement & {
      alertType: string;
    };
    expect(alert.textContent).toBe(t("editor.releases_no_sensors"));
    expect(alert.alertType).toBe("info");
  });

  it("adds a source through a sensor-only entity selector", () => {
    const { editor, configs } = createEditor({
      type: "custom:mushroom-meshcore-releases-card",
      sources: [],
      grid_options: { columns: "full", rows: 5 },
    });
    const add = forms(editor).find(
      (form) =>
        form.schema.length === 1 &&
        (form.schema[0] as Partial<HaFormExpandableSchema> | undefined)?.type !== "expandable"
    )!;
    const field = add.schema[0] as HaFormFieldSchema;
    expect(field.selector.entity?.domain).toBe("sensor");
    expect(field.selector.entity?.include_entities).toContain(FIRST);
    changeValue(add, { entity: null });
    changeValue(add, { entity: "binary_sensor.not_a_release" });
    expect(configs).toHaveLength(0);
    changeValue(add, { entity: FIRST });
    expect(lastConfig(configs)).toEqual({
      type: "custom:mushroom-meshcore-releases-card",
      sources: [{ entity: FIRST }],
      grid_options: { columns: "full", rows: 5 },
    });
    expect(editor.querySelectorAll(".source-editor-item")).toHaveLength(1);
  });

  it("edits a source entity and optional name while preventing duplicates", () => {
    const { editor, configs } = createEditor({
      sources: [{ entity: FIRST }, { entity: SECOND }],
    });
    const sourceForms = forms(editor).filter((form) => form.schema.length === 2);
    changeValue(sourceForms[0]!, { entity: null, name: "Ignored" });
    expect(configs).toHaveLength(0);
    changeValue(sourceForms[0]!, { entity: FIRST, name: null });
    expect(lastConfig(configs)?.sources).toEqual([
      { entity: FIRST },
      { entity: SECOND },
    ]);
    changeValue(sourceForms[0]!, { entity: FIRST, name: "MeshCore" });
    expect(lastConfig(configs)?.sources).toEqual([
      { entity: FIRST, name: "MeshCore" },
      { entity: SECOND },
    ]);
    const count = configs.length;
    changeValue(sourceForms[1]!, { entity: FIRST, name: "Duplicate" });
    expect(configs).toHaveLength(count);
  });

  it("reorders and removes sources with accessible fallback controls", () => {
    const { editor, configs } = createEditor({
      sources: [{ entity: FIRST }, { entity: SECOND }, { entity: THIRD }],
    });
    let items = Array.from(
      editor.querySelectorAll<HTMLElement>(".source-editor-item")
    );
    const firstUp = Array.from(
      items[0]!.querySelectorAll<HTMLButtonElement>(".source-order")
    ).find((button) => button.textContent === "↑")!;
    firstUp.click();
    expect(configs).toHaveLength(0);

    const secondUp = Array.from(
      items[1]!.querySelectorAll<HTMLButtonElement>(".source-order")
    ).find((button) => button.textContent === "↑")!;
    secondUp.click();
    expect(lastConfig(configs)?.sources?.map((source) => source.entity)).toEqual([
      SECOND,
      FIRST,
      THIRD,
    ]);

    items = Array.from(editor.querySelectorAll<HTMLElement>(".source-editor-item"));
    const down = Array.from(items[0]!.querySelectorAll<HTMLButtonElement>(".source-order")).find(
      (button) => button.textContent === "↓"
    )!;
    down.click();
    expect(lastConfig(configs)?.sources?.map((source) => source.entity)).toEqual([
      FIRST,
      SECOND,
      THIRD,
    ]);

    const list = editor.querySelector<HTMLElement>(".source-sortable-list")!;
    const ghost = document.createElement("div");
    ghost.className = "source-editor-item";
    list.appendChild(ghost);
    editor
      .querySelector("ha-sortable")!
      .dispatchEvent(new CustomEvent("item-moved"));
    expect(lastConfig(configs)?.sources?.map((source) => source.entity)).toEqual([
      FIRST,
      SECOND,
      THIRD,
    ]);

    editor.querySelector<HTMLButtonElement>(".source-remove")!.click();
    expect(lastConfig(configs)?.sources).toHaveLength(2);
  });

  it("labels every form and preserves the source disclosure state", () => {
    const { editor } = createEditor({ sources: [{ entity: FIRST }] });
    const allForms = forms(editor);
    const source = allForms.find((form) => form.schema.length === 2)!;
    const add = allForms.find(
      (form) =>
        form.schema.length === 1 &&
        (form.schema[0] as Partial<HaFormExpandableSchema> | undefined)?.type !==
          "expandable"
    )!;
    const settings = settingsForm(editor);
    for (const form of [source, add, settings]) {
      expect(form.computeLabel({ name: "bare", selector: {} })).toBe("bare");
      expect(
        form.computeLabel({
          name: "fallback",
          label: undefined,
          selector: {},
        })
      ).toBe("fallback");
      expect(
        form.computeLabel({
          name: "explicit",
          label: "Explicit label",
          selector: {},
        })
      ).toBe("Explicit label");
    }

    const organizer = editor.querySelector<HTMLDetailsElement>(
      ".source-organizer"
    )!;
    organizer.open = false;
    organizer.dispatchEvent(new Event("toggle"));
    editor.setConfig({ sources: [{ entity: FIRST }], name: "Releases" });
    expect(
      editor.querySelector<HTMLDetailsElement>(".source-organizer")!.open
    ).toBe(false);
  });

  it("uses locale fallbacks and handles sensor discovery without hass", () => {
    const bareEditor = new MeshcoreReleasesCardEditor();
    expect(
      (
        bareEditor as unknown as {
          _sensorEntities: () => string[];
        }
      )._sensorEntities()
    ).toEqual([]);

    const localeHass = editorHass();
    const mutableLocaleHass = localeHass as unknown as {
      language?: string;
      locale: { language?: string };
    };
    mutableLocaleHass.language = undefined;
    mutableLocaleHass.locale.language = "de";
    const { editor: localeEditor } = createEditor({ sources: [] }, localeHass);
    expect(localeEditor.querySelector("summary")?.textContent).toBe(
      makeLocalize("de")("editor.section_releases_sources")
    );

    const defaultHass = editorHass();
    const mutableDefaultHass = defaultHass as unknown as {
      language?: string;
      locale: { language?: string };
    };
    mutableDefaultHass.language = undefined;
    mutableDefaultHass.locale.language = undefined;
    const { editor: defaultEditor } = createEditor({ sources: [] }, defaultHass);
    expect(defaultEditor.querySelector("summary")?.textContent).toBe(
      t("editor.section_releases_sources")
    );
  });

  it("configures focused Appearance and Releases sections", () => {
    const { editor } = createEditor({ sources: [{ entity: FIRST }] });
    const settings = settingsForm(editor);
    const schema = settings.schema as HaFormExpandableSchema[];
    expect(schema.map((section) => section.title)).toEqual([
      t("editor.section_appearance"),
      t("editor.section_releases_behavior"),
    ]);
    expect(schema[0]!.schema.map((field) => field.name)).toEqual([
      "name",
      "icon",
      "icon_color",
    ]);
    expect(schema[1]!.schema.map((field) => field.name)).toEqual([
      "sort",
      "hide_age",
    ]);
    expect(settings.data).toEqual({
      name: "",
      icon: null,
      icon_color: null,
      sort: "newest",
      hide_age: false,
    });
  });

  it("normalizes settings and preserves sources and grid options", () => {
    const { editor, configs } = createEditor({
      sources: [{ entity: FIRST, name: "MeshCore" }],
      grid_options: { columns: "full", rows: 4 },
    });
    changeValue(settingsForm(editor), {
      name: "Software releases",
      icon: "mdi:download",
      icon_color: "blue",
      sort: "name",
      hide_age: true,
    });
    expect(lastConfig(configs)).toEqual({
      sources: [{ entity: FIRST, name: "MeshCore" }],
      name: "Software releases",
      icon: "mdi:download",
      icon_color: "blue",
      sort: "name",
      hide_age: true,
      grid_options: { columns: "full", rows: 4 },
    });
    changeValue(settingsForm(editor), {
      name: "",
      icon: null,
      icon_color: undefined,
      sort: "newest",
      hide_age: false,
    });
    expect(lastConfig(configs)).toEqual({
      sources: [{ entity: FIRST, name: "MeshCore" }],
      grid_options: { columns: "full", rows: 4 },
    });
  });

  it("preserves form identity across unchanged hass and config echoes", () => {
    const config = {
      sources: [{ entity: FIRST }],
      grid_options: { columns: "full" as const, rows: 4 },
    };
    const hass = editorHass();
    const { editor } = createEditor(config, hass);
    const before = forms(editor);
    editor.hass = hass;
    editor.setConfig(config);
    expect(forms(editor)).toEqual(before);
  });
});
