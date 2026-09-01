import type {
  ActionConfig,
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreCardTarget,
  MeshcoreChipId,
  MeshcoreChipLayout,
  HubInfo,
  NodeInfo,
  HaFormSchema,
  HaFormFieldSchema,
  HaFormElement,
  HaAlertElement,
} from "./types.js";
import { discoverHubs, discoverNodes } from "./discovery.js";
import { makeLocalize } from "./localize.js";
import { effectiveChipLayout } from "./chip-layout.js";

const EDITOR_STYLES = `
  .meshcore-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
  .chip-organizer { border-top: 1px solid var(--divider-color); border-bottom: 1px solid var(--divider-color); }
  .chip-organizer summary { padding: 14px 4px; cursor: pointer; font-weight: 500; }
  .chip-organizer-body { display: grid; gap: 12px; padding: 0 4px 14px; }
  .chip-help { margin: 0; color: var(--secondary-text-color); font-size: 12px; }
  .chip-zone { min-height: 42px; padding: 8px; border: 1px solid var(--divider-color); border-radius: 12px; }
  .chip-zone-title { margin: 0 0 6px; color: var(--secondary-text-color); font-size: 12px; font-weight: 500; }
  ha-sortable { display: block; min-height: 30px; }
  .chip-sortable-list { display: flex; min-height: 30px; flex-direction: column; gap: 6px; }
  .chip-editor-item { display: flex; min-height: 36px; align-items: center; gap: 6px; padding: 0 6px; border-radius: 10px; background: var(--secondary-background-color); }
  .chip-drag { padding: 6px; border: 0; background: transparent; color: var(--secondary-text-color); cursor: grab; }
  .chip-name { min-width: 0; flex: 1; font-size: 14px; }
  .chip-destination { max-width: 104px; }
  .chip-order { padding: 4px 6px; border: 0; background: transparent; color: var(--primary-text-color); cursor: pointer; }
  .chip-reset { justify-self: start; padding: 8px 12px; border: 1px solid var(--divider-color); border-radius: 12px; background: transparent; color: var(--primary-text-color); cursor: pointer; }
`;

const DEVICE_SETTING_KEYS = [
  "name",
  "icon",
  "icon_color",
  "tap_action",
  "hold_action",
  "double_tap_action",
  "hide_battery",
  "hide_metrics",
  "hide_signal_graphs",
  "hide_quick_stats",
  "show_firmware",
  "chip_layout",
  "hide_details",
  "details_default_open",
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

const STRING_SETTING_KEYS = ["name", "icon", "icon_color"] as const;

const BOOLEAN_SETTING_KEYS = [
  "hide_battery",
  "hide_metrics",
  "hide_signal_graphs",
  "hide_details",
  "details_default_open",
] as const;

const ACTION_SETTING_KEYS = [
  "tap_action",
  "hold_action",
  "double_tap_action",
] as const;

export class MeshcoreCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreCardConfig;
  private _discoveryFp = "";
  private _chipsOpen = true;

  setConfig(config: MeshcoreCardConfig): void {
    // HA echoes our own config-changed dispatch back through setConfig; a
    // teardown re-render there would collapse expansion panels and drop the
    // typing focus, so only rebuild when the config actually differs.
    const next = { ...config };
    const unchanged =
      this._config !== undefined &&
      JSON.stringify(next) === JSON.stringify(this._config);
    this._config = next;
    if (!unchanged) this._renderEditor();
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
    const isNode = target.type === "node";

    const appearance: HaFormFieldSchema[] = [
      { name: "name", label: t("editor.name_label"), selector: { text: {} } },
      { name: "icon", label: t("editor.icon_label"), selector: { icon: {} } },
      { name: "icon_color", label: t("editor.icon_color_label"), selector: { ui_color: {} } },
      { name: "hide_battery", label: t("editor.hide_battery"), selector: { boolean: {} } },
      ...(isNode
        ? [
            { name: "hide_metrics", label: t("editor.hide_metrics"), selector: { boolean: {} } },
            { name: "hide_signal_graphs", label: t("editor.hide_signal_graphs"), selector: { boolean: {} } },
          ] as HaFormFieldSchema[]
        : []),
      { name: "hide_details", label: t("editor.hide_details"), selector: { boolean: {} } },
      { name: "details_default_open", label: t("editor.details_default_open"), selector: { boolean: {} } },
    ];

    const interactions: HaFormFieldSchema[] = [
      { name: "tap_action", label: t("editor.tap_action"), selector: { ui_action: { default_action: "more-info" } } },
      { name: "hold_action", label: t("editor.hold_action"), selector: { ui_action: { default_action: "none" } } },
      { name: "double_tap_action", label: t("editor.double_tap_action"), selector: { ui_action: { default_action: "none" } } },
    ];

    const mapSchema: HaFormFieldSchema[] = [
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

    let entities: HaFormFieldSchema[];
    let behavior: HaFormFieldSchema[];

    if (!isNode) {
      const ids = Object.keys(this._hass?.states ?? {}).filter((id) => id.includes(target.id));
      const dcSel = (deviceClass: string) =>
        (ids.length
          ? { entity: { include_entities: ids, device_class: deviceClass } }
          : { entity: { domain: "sensor", device_class: deviceClass } }) as never;
      entities = [
        { name: "battery_entity", label: t("editor.battery_entity"), selector: dcSel("battery") },
        { name: "voltage_entity", label: t("editor.voltage_entity"), selector: dcSel("voltage") },
      ];
      behavior = mapSchema;
    } else {
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
      entities = [
        { name: "battery_entity", label: t("editor.battery_entity"), selector: dcSel("battery") },
        { name: "voltage_entity", label: t("editor.voltage_entity"), selector: dcSel("voltage") },
        { name: "location_entity", label: t("editor.location_entity"), selector: locSel },
        { name: "temperature_entity", label: t("editor.temperature_entity"), selector: devSel },
        { name: "humidity_entity", label: t("editor.humidity_entity"), selector: devSel },
        { name: "illuminance_entity", label: t("editor.illuminance_entity"), selector: devSel },
        { name: "pressure_entity", label: t("editor.pressure_entity"), selector: devSel },
      ];
      behavior = [
        { name: "show_neighbors", label: t("editor.show_neighbors"), selector: { boolean: {} } },
        { name: "max_neighbors", label: t("editor.max_neighbors"), selector: { number: { min: 0, mode: "box" } } },
        ...mapSchema,
      ];
    }

    const section = (title: string, icon: string, schema: HaFormFieldSchema[]): HaFormSchema => ({
      type: "expandable",
      name: "",
      flatten: true,
      title,
      icon,
      schema,
    });

    return [
      section(t("editor.section_appearance"), "mdi:palette", appearance),
      section(t("editor.section_interactions"), "mdi:gesture-tap", interactions),
      section(t("editor.section_entities"), "mdi:tune", entities),
      section(
        t(isNode ? "editor.section_behavior" : "editor.section_map"),
        "mdi:map-marker",
        behavior
      ),
    ];
  }

  private _settingsData(target: MeshcoreCardTarget): Record<string, unknown> {
    const config = this._config ?? {};
    const data: Record<string, unknown> = {
      name: config.name ?? "",
      icon: config.icon ?? null,
      icon_color: config.icon_color ?? null,
      tap_action: config.tap_action,
      hold_action: config.hold_action,
      double_tap_action: config.double_tap_action,
      hide_battery: config.hide_battery === true,
      hide_details: config.hide_details === true,
      details_default_open: config.details_default_open === true,
      battery_entity: config.battery_entity ?? null,
      voltage_entity: config.voltage_entity ?? null,
      map_provider: config.map_provider === "meshmapper" ? "meshmapper" : "analyzer",
      map_metro: config.map_metro ?? "",
    };
    if (target.type === "node") {
      data["hide_metrics"] = config.hide_metrics === true;
      data["hide_signal_graphs"] = config.hide_signal_graphs === true;
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
      // The form survives the setConfig echo, so its aggregate data must be
      // kept current or the next field edit would revert this one.
      form.data = value;
      const config: MeshcoreCardConfig = { ...this._config };
      for (const key of ENTITY_SETTING_KEYS) {
        const entityId = value[key];
        if (typeof entityId === "string" && entityId) config[key] = entityId;
        else delete config[key];
      }
      for (const key of STRING_SETTING_KEYS) {
        const raw = value[key];
        if (typeof raw === "string" && raw.trim()) config[key] = raw;
        else delete config[key];
      }
      for (const key of BOOLEAN_SETTING_KEYS) {
        if (value[key] === true) config[key] = true;
        else delete config[key];
      }
      for (const key of ACTION_SETTING_KEYS) {
        const raw = value[key];
        if (raw && typeof raw === "object" && typeof (raw as ActionConfig).action === "string") {
          config[key] = raw as ActionConfig;
        } else {
          delete config[key];
        }
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

  private _chipLabel(id: MeshcoreChipId, t: ReturnType<typeof makeLocalize>): string {
    const keys: Record<MeshcoreChipId, string> = {
      hardware: "card.hardware",
      firmware: "card.firmware",
      sent: "card.traffic_sent",
      received: "card.traffic_received",
      temperature: "card.telemetry_temp",
      uptime: "card.uptime_label",
      neighbor_count: "card.neighbors_48h_label",
      route: "card.routing_path",
      path_length: "card.path_length",
      spreading_factor: "card.spreading_factor",
      frequency: "card.frequency",
      bandwidth: "card.bandwidth",
      tx_power: "card.tx_power",
      relayed: "card.traffic_relayed",
      canceled: "card.traffic_canceled",
      duplicate: "card.traffic_duplicate",
      sent_direct: "card.traffic_sent_direct",
      sent_flood: "card.traffic_sent_flood",
      received_direct: "card.traffic_received_direct",
      received_flood: "card.traffic_received_flood",
      direct_duplicates: "card.traffic_direct_duplicates",
      flood_duplicates: "card.traffic_flood_duplicates",
      queue_full_events: "card.traffic_queue_full_events",
      receive_errors: "card.traffic_receive_errors",
      tx_airtime: "card.tx_airtime_label",
      rx_airtime: "card.rx_airtime_label",
      tx_airtime_total: "card.tx_airtime_total_label",
      rx_airtime_total: "card.rx_airtime_total_label",
      queue_length: "card.chip_queue",
      tx_rate: "card.chip_tx_rate",
      rx_rate: "card.chip_rx_rate",
      sent_direct_rate: "card.traffic_sent_direct_rate",
      sent_flood_rate: "card.traffic_sent_flood_rate",
      received_direct_rate: "card.traffic_received_direct_rate",
      received_flood_rate: "card.traffic_received_flood_rate",
      direct_duplicates_rate: "card.traffic_direct_duplicates_rate",
      flood_duplicates_rate: "card.traffic_flood_duplicates_rate",
      receive_errors_rate: "card.traffic_receive_errors_rate",
      request_successes: "card.request_successes_label",
      request_failures: "card.request_failures_label",
      humidity: "card.telemetry_humidity",
      illuminance: "card.telemetry_lux",
      pressure: "card.telemetry_pressure",
      ch1_voltage: "card.chip_ch1",
      rate_limiter: "card.chip_rate",
    };
    return t(keys[id]);
  }

  private _readChipLayout(organizer: HTMLElement): MeshcoreChipLayout {
    const read = (zone: string): MeshcoreChipId[] =>
      Array.from(organizer.querySelectorAll<HTMLElement>(`ha-sortable[data-zone="${zone}"] .chip-editor-item`))
        .map((item) => item.getAttribute("data-chip") as MeshcoreChipId)
        .filter(Boolean);
    return { top: read("top"), details: read("details"), hidden: read("hidden") };
  }

  private _saveChipLayout(organizer: HTMLElement): void {
    for (const zone of ["top", "details", "hidden"]) {
      organizer.querySelectorAll<HTMLSelectElement>(`ha-sortable[data-zone="${zone}"] .chip-destination`)
        .forEach((select) => { select.value = zone; });
    }
    const config: MeshcoreCardConfig = { ...this._config };
    config.chip_layout = this._readChipLayout(organizer);
    delete config.hide_quick_stats;
    delete config.show_firmware;
    this._removeLegacyFields(config);
    this._dispatchConfig(config);
  }

  private _chipOrganizer(target: MeshcoreCardTarget): HTMLElement {
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    const details = document.createElement("details");
    details.className = "chip-organizer";
    details.open = this._chipsOpen;
    details.addEventListener("toggle", () => { this._chipsOpen = details.open; });
    const summary = document.createElement("summary");
    summary.textContent = t("editor.section_chips");
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "chip-organizer-body";
    const help = document.createElement("p");
    help.className = "chip-help";
    help.textContent = t("editor.chips_help");
    body.appendChild(help);

    // The organizer is only mounted after _renderEditor confirms a target.
    const layout = effectiveChipLayout(target, this._config!);
    const zoneLabels: Record<keyof MeshcoreChipLayout, string> = {
      top: t("editor.chips_top"),
      details: t("editor.chips_details"),
      hidden: t("editor.chips_hidden"),
    };
    const sortables: Record<string, HTMLElement> = {};

    for (const zone of ["top", "details", "hidden"] as const) {
      const wrapper = document.createElement("section");
      wrapper.className = "chip-zone";
      const heading = document.createElement("h4");
      heading.className = "chip-zone-title";
      heading.textContent = zoneLabels[zone];
      wrapper.appendChild(heading);

      const sortable = document.createElement("ha-sortable") as HTMLElement & {
        group?: string;
        handleSelector?: string;
        draggableSelector?: string;
        rollback?: boolean;
      };
      if (typeof sortable.setAttribute === "function") sortable.setAttribute("data-zone", zone);
      sortable.group = "meshcore-card-chips";
      sortable.handleSelector = ".chip-drag";
      sortable.draggableSelector = ".chip-editor-item";
      sortable.rollback = false;
      sortables[zone] = sortable;

      const list = document.createElement("div");
      list.className = "chip-sortable-list";

      for (const id of layout[zone]) {
        const item = document.createElement("div");
        item.className = "chip-editor-item";
        if (typeof item.setAttribute === "function") item.setAttribute("data-chip", id);

        const drag = document.createElement("button");
        drag.type = "button";
        drag.className = "chip-drag";
        drag.textContent = "☰";
        if (typeof drag.setAttribute === "function") drag.setAttribute("aria-label", t("editor.chip_drag", { name: this._chipLabel(id, t) }));
        item.appendChild(drag);

        const name = document.createElement("span");
        name.className = "chip-name";
        name.textContent = this._chipLabel(id, t);
        item.appendChild(name);

        const select = document.createElement("select");
        select.className = "chip-destination";
        if (typeof select.setAttribute === "function") select.setAttribute("aria-label", t("editor.chip_destination", { name: this._chipLabel(id, t) }));
        for (const destination of ["top", "details", "hidden"] as const) {
          const option = document.createElement("option");
          option.value = destination;
          option.textContent = zoneLabels[destination];
          option.selected = destination === zone;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          const destination = sortables[select.value]?.firstElementChild;
          destination?.appendChild(item);
          this._saveChipLayout(details);
        });
        item.appendChild(select);

        for (const [direction, symbol] of [[-1, "↑"], [1, "↓"]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "chip-order";
          button.textContent = symbol;
          if (typeof button.setAttribute === "function") button.setAttribute("aria-label", t(direction < 0 ? "editor.chip_move_up" : "editor.chip_move_down", { name: this._chipLabel(id, t) }));
          button.addEventListener("click", () => {
            const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
            if (!sibling) return;
            if (direction < 0) item.parentElement?.insertBefore(item, sibling);
            else item.parentElement?.insertBefore(sibling, item);
            this._saveChipLayout(details);
          });
          item.appendChild(button);
        }
        list.appendChild(item);
      }
      sortable.appendChild(list);
      // `ha-sortable` emits item-moved for same-list reorders and item-added
      // after a cross-list drop. Both events fire after the DOM order changes.
      sortable.addEventListener("item-moved", () => this._saveChipLayout(details));
      sortable.addEventListener("item-added", () => this._saveChipLayout(details));
      wrapper.appendChild(sortable);
      body.appendChild(wrapper);
    }

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "chip-reset";
    reset.textContent = t("editor.chips_reset");
    reset.addEventListener("click", () => {
      const config: MeshcoreCardConfig = { ...this._config };
      delete config.chip_layout;
      delete config.hide_quick_stats;
      delete config.show_firmware;
      this._dispatchConfig(config);
      this._renderEditor();
    });
    body.appendChild(reset);
    details.appendChild(body);
    return details;
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
      if (this._config.target) {
        container.appendChild(this._chipOrganizer(this._config.target));
        container.appendChild(this._settingsForm(this._config.target));
      }
    }
    this.appendChild(container);
  }
}
