import type {
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreCardTarget,
  HubInfo,
  NodeInfo,
  HaFormSchema,
  HaFormElement,
  HaAlertElement,
} from "./types.js";
import { discoverHubs, discoverNodes } from "./discovery.js";
import { makeLocalize } from "./localize.js";

const EDITOR_STYLES = `
  .meshcore-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
`;

const DEVICE_SETTING_KEYS = [
  "battery_entity",
  "voltage_entity",
  "location_entity",
  "temperature_entity",
  "humidity_entity",
  "illuminance_entity",
  "pressure_entity",
  "show_neighbors",
  "max_neighbors",
] as const;

const ENTITY_SETTING_KEYS = [
  "battery_entity",
  "voltage_entity",
  "location_entity",
  "temperature_entity",
  "humidity_entity",
  "illuminance_entity",
  "pressure_entity",
] as const;

export class MeshcoreCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreCardConfig;
  private _discoveryFp = "";

  setConfig(config: MeshcoreCardConfig): void {
    this._config = { ...config };
    this._renderEditor();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.querySelectorAll<HaFormElement>("ha-form").forEach((form) => {
      form.hass = hass;
    });
    const hubs = this._discoverHubs();
    const nodes = this._discoverNodes();
    const fp = hubs.map((hub) => `${hub.pubkey}:${hub.name}`).join(",")
      + "|"
      + nodes.map((node) => `${node.deviceId}:${node.name}`).join(",");
    if (fp !== this._discoveryFp) {
      this._discoveryFp = fp;
      this._renderEditor();
    }
  }

  private _discoverHubs(): HubInfo[] {
    return this._hass ? discoverHubs(this._hass) : [];
  }

  private _discoverNodes(): NodeInfo[] {
    return this._hass ? discoverNodes(this._hass) : [];
  }

  private _targetValue(target: MeshcoreCardTarget | undefined): string {
    return target ? JSON.stringify(target) : "";
  }

  private _parseTarget(value: unknown): MeshcoreCardTarget | undefined {
    if (typeof value !== "string" || !value) return undefined;
    try {
      const parsed = JSON.parse(value) as Partial<MeshcoreCardTarget>;
      if (
        (parsed.type === "hub" || parsed.type === "node") &&
        typeof parsed.id === "string" &&
        parsed.id
      ) {
        return { type: parsed.type, id: parsed.id };
      }
    } catch {
      // Invalid select values are treated as no target.
    }
    return undefined;
  }

  private _sameTarget(
    a: MeshcoreCardTarget | undefined,
    b: MeshcoreCardTarget | undefined
  ): boolean {
    return a?.type === b?.type && a?.id === b?.id;
  }

  private _dispatchConfig(config: MeshcoreCardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config } }));
  }

  private _clearDeviceSettings(config: MeshcoreCardConfig): void {
    for (const key of DEVICE_SETTING_KEYS) delete config[key];
  }

  private _removeLegacyFields(config: MeshcoreCardConfig): void {
    const legacy = config as MeshcoreCardConfig & Record<string, unknown>;
    delete legacy["hubs"];
    delete legacy["nodes"];
    delete legacy["nodes_order"];
  }

  private _targetOptions(
    hubs: HubInfo[],
    nodes: NodeInfo[]
  ): { value: string; label: string }[] {
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    return [
      ...hubs.map((hub) => ({
        value: this._targetValue({ type: "hub", id: hub.pubkey }),
        label: t("editor.target_hub", {
          name: hub.name.replace(/_/g, " "),
          id: hub.pubkey,
        }),
      })),
      ...nodes.map((node) => ({
        value: this._targetValue({ type: "node", id: node.name }),
        label: t("editor.target_node", { name: node.name.replace(/_/g, " ") }),
      })),
    ];
  }

  private _targetForm(hubs: HubInfo[], nodes: NodeInfo[]): HaFormElement {
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) => ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      {
        name: "target",
        label: t("editor.target_device"),
        selector: {
          select: {
            mode: "dropdown",
            options: this._targetOptions(hubs, nodes),
          },
        },
      },
    ];
    form.data = { target: this._targetValue(this._config?.target) };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (event as CustomEvent<{ value: Record<string, unknown> }>).detail.value;
      const target = this._parseTarget(value["target"]);
      const config: MeshcoreCardConfig = { ...this._config };
      if (!this._sameTarget(config.target, target)) this._clearDeviceSettings(config);
      if (target) config.target = target;
      else delete config.target;
      this._removeLegacyFields(config);
      this._dispatchConfig(config);
      this._renderEditor();
    });
    return form;
  }

  private _selectedNode(): NodeInfo | undefined {
    const target = this._config?.target;
    if (target?.type !== "node") return undefined;
    return this._discoverNodes().find((node) => node.name === target.id);
  }

  private _settingsSchema(target: MeshcoreCardTarget): HaFormSchema[] {
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    const mapSchema: HaFormSchema[] = [
      {
        name: "map_provider",
        label: t("editor.map_provider"),
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "analyzer", label: "LetsMesh Analyzer" },
              { value: "meshmapper", label: "MeshMapper" },
            ],
          },
        },
      },
      { name: "map_metro", label: t("editor.map_metro"), selector: { text: {} } },
    ];

    if (target.type === "hub") {
      const ids = Object.keys(this._hass?.states ?? {}).filter((id) => id.includes(target.id));
      const dcSel = (deviceClass: string) =>
        (ids.length
          ? { entity: { include_entities: ids, device_class: deviceClass } }
          : { entity: { domain: "sensor", device_class: deviceClass } }) as never;
      return [
        { name: "battery_entity", label: t("editor.battery_entity"), selector: dcSel("battery") },
        { name: "voltage_entity", label: t("editor.voltage_entity"), selector: dcSel("voltage") },
        ...mapSchema,
      ];
    }

    const node = this._selectedNode();
    const meshcoreIds = this._hass?.entities
      ? Object.entries(this._hass.entities)
          .filter(([, info]) => info.platform === "meshcore")
          .map(([id]) => id)
      : [];
    const ids = node && this._hass?.entities
      ? Object.entries(this._hass.entities)
          .filter(([, info]) => info.device_id === node.deviceId)
          .map(([id]) => id)
      : [];
    const dcSel = (deviceClass: string) =>
      (ids.length
        ? { entity: { include_entities: ids, device_class: deviceClass } }
        : { entity: { domain: "sensor", device_class: deviceClass } }) as never;
    const devSel = ids.length
      ? { entity: { include_entities: ids } }
      : { entity: { domain: "sensor" } };
    const locSel = meshcoreIds.length
      ? { entity: { include_entities: meshcoreIds } }
      : { entity: { domain: "sensor" } };

    return [
      { name: "battery_entity", label: t("editor.battery_entity"), selector: dcSel("battery") },
      { name: "voltage_entity", label: t("editor.voltage_entity"), selector: dcSel("voltage") },
      { name: "location_entity", label: t("editor.location_entity"), selector: locSel },
      { name: "temperature_entity", label: t("editor.temperature_entity"), selector: devSel },
      { name: "humidity_entity", label: t("editor.humidity_entity"), selector: devSel },
      { name: "illuminance_entity", label: t("editor.illuminance_entity"), selector: devSel },
      { name: "pressure_entity", label: t("editor.pressure_entity"), selector: devSel },
      { name: "show_neighbors", label: t("editor.show_neighbors"), selector: { boolean: {} } },
      { name: "max_neighbors", label: t("editor.max_neighbors"), selector: { number: { min: 0, mode: "box" } } },
      ...mapSchema,
    ];
  }

  private _settingsData(target: MeshcoreCardTarget): Record<string, unknown> {
    const config = this._config ?? {};
    const data: Record<string, unknown> = {
      battery_entity: config.battery_entity ?? null,
      voltage_entity: config.voltage_entity ?? null,
      map_provider: config.map_provider === "meshmapper" ? "meshmapper" : "analyzer",
      map_metro: config.map_metro ?? "",
    };
    if (target.type === "node") {
      data["location_entity"] = config.location_entity ?? null;
      data["temperature_entity"] = config.temperature_entity ?? null;
      data["humidity_entity"] = config.humidity_entity ?? null;
      data["illuminance_entity"] = config.illuminance_entity ?? null;
      data["pressure_entity"] = config.pressure_entity ?? null;
      data["show_neighbors"] = config.show_neighbors !== false;
      data["max_neighbors"] = config.max_neighbors ?? null;
    }
    return data;
  }

  private _settingsForm(target: MeshcoreCardTarget): HaFormElement {
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) => ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = this._settingsSchema(target);
    form.data = this._settingsData(target);
    form.addEventListener("value-changed", (event: Event) => {
      const value = (event as CustomEvent<{ value: Record<string, unknown> }>).detail.value;
      const config: MeshcoreCardConfig = { ...this._config };
      for (const key of ENTITY_SETTING_KEYS) {
        const entityId = value[key];
        if (typeof entityId === "string" && entityId) config[key] = entityId;
        else delete config[key];
      }
      if (target.type === "node" && value["show_neighbors"] === false) {
        config.show_neighbors = false;
      } else {
        delete config.show_neighbors;
      }
      const maxNeighbors = Number(value["max_neighbors"]);
      if (target.type === "node" && Number.isFinite(maxNeighbors) && maxNeighbors > 0) {
        config.max_neighbors = maxNeighbors;
      } else {
        delete config.max_neighbors;
      }
      if (value["map_provider"] === "meshmapper") config.map_provider = "meshmapper";
      else delete config.map_provider;
      const metro = String(value["map_metro"] ?? "").trim();
      if (metro) config.map_metro = metro;
      else delete config.map_metro;
      this._removeLegacyFields(config);
      this._dispatchConfig(config);
    });
    return form;
  }

  private _renderEditor(): void {
    if (!this._config) return;
    while (this.lastChild) this.removeChild(this.lastChild);

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    this.appendChild(style);

    const container = document.createElement("div");
    container.className = "meshcore-editor";
    const hubs = this._discoverHubs();
    const nodes = this._discoverNodes();
    if (!hubs.length && !nodes.length) {
      const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
      const alert = document.createElement("ha-alert") as HaAlertElement;
      alert.alertType = "info";
      alert.textContent = t("editor.no_devices_detected");
      container.appendChild(alert);
    } else {
      container.appendChild(this._targetForm(hubs, nodes));
      if (this._config.target) container.appendChild(this._settingsForm(this._config.target));
    }
    this.appendChild(container);
  }
}
