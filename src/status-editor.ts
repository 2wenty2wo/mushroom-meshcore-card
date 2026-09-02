import type {
  ActionConfig,
  HaAlertElement,
  HaFormElement,
  HaFormFieldSchema,
  HaFormSchema,
  HomeAssistant,
  MeshcoreHubTarget,
  MeshcoreStatusBadgeConfig,
  MeshcoreStatusCardConfig,
} from "./types.js";
import { discoverHubs, discoverNodes } from "./discovery.js";
import { makeLocalize } from "./localize.js";

type StatusConfig = MeshcoreStatusCardConfig | MeshcoreStatusBadgeConfig;

const EDITOR_STYLES = `
  .meshcore-status-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
`;

const ENTITY_KEYS = ["status_entity", "battery_entity"] as const;
const STRING_KEYS = ["name", "icon", "icon_color"] as const;
const ACTION_KEYS = [
  "tap_action",
  "hold_action",
  "double_tap_action",
] as const;
const CARD_BOOLEAN_KEYS = [
  "hide_monitored_nodes",
  "monitored_nodes_default_open",
  "hide_diagnostics",
  "diagnostics_default_open",
] as const;

abstract class MeshcoreStatusEditorBase<T extends StatusConfig> extends HTMLElement {
  protected abstract readonly _isBadge: boolean;
  private _hass?: HomeAssistant;
  private _config?: T;
  private _discoveryFingerprint = "";

  setConfig(config: T): void {
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
    const hubs = discoverHubs(hass);
    const nodes = discoverNodes(hass);
    const fingerprint = [
      ...hubs.map((hub) => `${hub.pubkey}:${hub.name}:${hub.nodeCountEntity}`),
      ...nodes.map((node) => `${node.hubPubkey}:${node.deviceId}:${node.name}`),
    ].join("|");
    if (fingerprint !== this._discoveryFingerprint) {
      this._discoveryFingerprint = fingerprint;
      this._renderEditor();
    }
  }

  private _localize() {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _targetValue(target: MeshcoreHubTarget | undefined): string {
    return target?.type === "hub" ? target.id : "";
  }

  private _targetFromValue(value: unknown): MeshcoreHubTarget | undefined {
    return typeof value === "string" && value.trim()
      ? { type: "hub", id: value.trim() }
      : undefined;
  }

  private _dispatch(config: T, rerender = false): void {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config } })
    );
    if (rerender) this._renderEditor();
  }

  private _targetForm(): HaFormElement {
    const t = this._localize();
    const hubs = this._hass ? discoverHubs(this._hass) : [];
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      {
        name: "target",
        label: t("editor.status_target_hub"),
        selector: {
          select: {
            mode: "dropdown",
            options: hubs.map((hub) => ({
              value: hub.pubkey,
              label: t("editor.target_hub", {
                name: hub.name.replace(/_/g, " "),
                id: hub.pubkey,
              }),
            })),
          },
        },
      },
    ];
    form.data = { target: this._targetValue(this._config?.target) };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      const target = this._targetFromValue(value["target"]);
      const previous = this._config?.target;
      const changed =
        previous?.type !== target?.type || previous?.id !== target?.id;
      const config = { ...this._config } as T;
      if (target) config.target = target;
      else delete config.target;
      if (changed) {
        delete config.excluded_nodes;
        delete config.status_entity;
        delete config.battery_entity;
      }
      this._dispatch(config, true);
    });
    return form;
  }

  private _hubEntityIds(domain?: string): string[] {
    const target = this._config?.target;
    if (!this._hass || target?.type !== "hub") return [];
    const hub = discoverHubs(this._hass).find(
      (candidate) => candidate.pubkey === target.id
    );
    const deviceId = hub?.deviceId ?? null;
    if (!deviceId) return [];
    return Object.entries(this._hass.entities)
      .filter(
        ([entityId, entry]) =>
          entry.device_id === deviceId &&
          (!domain || entityId.startsWith(`${domain}.`))
      )
      .map(([entityId]) => entityId)
      .sort();
  }

  private _monitoredNodeNames(): string[] {
    const target = this._config?.target;
    if (!this._hass || target?.type !== "hub") return [];
    return discoverNodes(this._hass)
      .filter((node) => node.hubPubkey === target.id)
      .map((node) => node.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private _section(
    title: string,
    icon: string,
    schema: HaFormFieldSchema[]
  ): HaFormSchema {
    return {
      type: "expandable",
      name: "",
      flatten: true,
      title,
      icon,
      schema,
    };
  }

  private _settingsForm(): HaFormElement {
    const t = this._localize();
    const nodeNames = this._monitoredNodeNames();
    const entitySelector = (domain?: string) => {
      const hubEntities = this._hubEntityIds(domain);
      return hubEntities.length
        ? { entity: { include_entities: hubEntities } }
        : { entity: domain ? { domain } : {} };
    };
    const exclusionsSelector = {
      select: {
        multiple: true,
        mode: "dropdown",
        options: nodeNames.map((name) => ({ value: name, label: name })),
      },
    } as never;
    const interactions: HaFormFieldSchema[] = [
      {
        name: "tap_action",
        label: t(
          this._isBadge ? "editor.status_badge_tap_action" : "editor.tap_action"
        ),
        selector: {
          ui_action: this._isBadge ? {} : { default_action: "more-info" },
        },
      },
      {
        name: "hold_action",
        label: t("editor.hold_action"),
        selector: { ui_action: { default_action: "none" } },
      },
      {
        name: "double_tap_action",
        label: t("editor.double_tap_action"),
        selector: { ui_action: { default_action: "none" } },
      },
    ];
    const behavior: HaFormFieldSchema[] = [
      {
        name: "low_battery_threshold",
        label: t("editor.status_low_battery_threshold"),
        selector: { number: { min: 0, max: 100, step: 1, mode: "box" } },
      },
      {
        name: "excluded_nodes",
        label: t("editor.status_excluded_nodes"),
        selector: exclusionsSelector,
      },
    ];
    if (!this._isBadge) {
      behavior.push(
        {
          name: "hide_monitored_nodes",
          label: t("editor.status_hide_monitored_nodes"),
          selector: { boolean: {} },
        },
        {
          name: "monitored_nodes_default_open",
          label: t("editor.status_monitored_nodes_default_open"),
          selector: { boolean: {} },
        },
        {
          name: "hide_diagnostics",
          label: t("editor.status_hide_diagnostics"),
          selector: { boolean: {} },
        },
        {
          name: "diagnostics_default_open",
          label: t("editor.status_diagnostics_default_open"),
          selector: { boolean: {} },
        }
      );
    }

    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      this._section(t("editor.section_appearance"), "mdi:palette", [
        { name: "name", label: t("editor.name_label"), selector: { text: {} } },
        { name: "icon", label: t("editor.icon_label"), selector: { icon: {} } },
        {
          name: "icon_color",
          label: t("editor.icon_color_label"),
          selector: { ui_color: {} },
        },
      ]),
      this._section(
        t("editor.section_interactions"),
        "mdi:gesture-tap",
        interactions
      ),
      this._section(t("editor.section_entities"), "mdi:tune", [
        {
          name: "status_entity",
          label: t("editor.status_status_entity"),
          selector: entitySelector() as never,
        },
        {
          name: "battery_entity",
          label: t("editor.battery_entity"),
          selector: entitySelector("sensor") as never,
        },
      ]),
      this._section(
        t("editor.status_section_behavior"),
        "mdi:access-point-network",
        behavior
      ),
    ];
    form.data = {
      name: this._config?.name ?? "",
      icon: this._config?.icon ?? null,
      icon_color: this._config?.icon_color ?? null,
      tap_action: this._config?.tap_action,
      hold_action: this._config?.hold_action,
      double_tap_action: this._config?.double_tap_action,
      status_entity: this._config?.status_entity ?? null,
      battery_entity: this._config?.battery_entity ?? null,
      low_battery_threshold: this._config?.low_battery_threshold ?? 50,
      excluded_nodes: this._config?.excluded_nodes ?? [],
      ...(!this._isBadge
        ? {
            hide_monitored_nodes:
              (this._config as MeshcoreStatusCardConfig)?.hide_monitored_nodes ===
              true,
            monitored_nodes_default_open:
              (this._config as MeshcoreStatusCardConfig)
                ?.monitored_nodes_default_open === true,
            hide_diagnostics:
              (this._config as MeshcoreStatusCardConfig)?.hide_diagnostics ===
              true,
            diagnostics_default_open:
              (this._config as MeshcoreStatusCardConfig)
                ?.diagnostics_default_open === true,
          }
        : {}),
    };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config = { ...this._config } as T;

      for (const key of STRING_KEYS) {
        const raw = value[key];
        if (typeof raw === "string" && raw.trim()) config[key] = raw.trim();
        else delete config[key];
      }
      for (const key of ENTITY_KEYS) {
        const raw = value[key];
        if (typeof raw === "string" && raw) config[key] = raw;
        else delete config[key];
      }
      for (const key of ACTION_KEYS) {
        const raw = value[key];
        if (
          raw &&
          typeof raw === "object" &&
          typeof (raw as ActionConfig).action === "string"
        ) {
          config[key] = raw as ActionConfig;
        } else {
          delete config[key];
        }
      }
      const threshold = Number(value["low_battery_threshold"]);
      if (
        Number.isFinite(threshold) &&
        threshold >= 0 &&
        threshold <= 100 &&
        threshold !== 50
      ) {
        config.low_battery_threshold = threshold;
      } else {
        delete config.low_battery_threshold;
      }
      const excluded = Array.isArray(value["excluded_nodes"])
        ? value["excluded_nodes"].flatMap((entry) => {
            if (typeof entry !== "string") return [];
            const name = entry.trim();
            return name ? [name] : [];
          })
        : [];
      if (excluded.length) config.excluded_nodes = [...new Set(excluded)];
      else delete config.excluded_nodes;

      if (!this._isBadge) {
        const cardConfig = config as MeshcoreStatusCardConfig;
        for (const key of CARD_BOOLEAN_KEYS) {
          if (value[key] === true) cardConfig[key] = true;
          else delete cardConfig[key];
        }
      }
      this._dispatch(config);
    });
    return form;
  }

  private _alert(message: string, type: HaAlertElement["alertType"]): HTMLElement {
    const alert = document.createElement("ha-alert") as HaAlertElement;
    alert.alertType = type;
    alert.textContent = message;
    return alert;
  }

  private _renderEditor(): void {
    if (!this._hass || !this._config) return;
    const t = this._localize();
    this.replaceChildren();
    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    const wrapper = document.createElement("div");
    wrapper.className = "meshcore-status-editor";
    wrapper.appendChild(this._targetForm());

    const hubs = discoverHubs(this._hass);
    if (!hubs.length) {
      wrapper.appendChild(
        this._alert(t("editor.no_hubs_detected"), "warning")
      );
    }
    const target = this._config.target;
    if (target?.type === "hub") {
      const names = this._monitoredNodeNames();
      const nameCounts = new Map<string, { name: string; count: number }>();
      for (const name of names) {
        const key = name.trim().toLocaleLowerCase();
        const existing = nameCounts.get(key);
        if (existing) existing.count += 1;
        else nameCounts.set(key, { name, count: 1 });
      }
      const duplicateNames = [...nameCounts.values()]
        .filter(({ count }) => count > 1)
        .map(({ name }) => name);
      if (duplicateNames.length) {
        wrapper.appendChild(
          this._alert(
            t("editor.status_duplicate_node_names", {
              names: duplicateNames.join(", "),
            }),
            "warning"
          )
        );
      }
      wrapper.appendChild(this._settingsForm());
    }
    this.append(style, wrapper);
  }
}

export class MeshcoreStatusCardEditor extends MeshcoreStatusEditorBase<MeshcoreStatusCardConfig> {
  protected readonly _isBadge = false;
}

export class MeshcoreStatusBadgeEditor extends MeshcoreStatusEditorBase<MeshcoreStatusBadgeConfig> {
  protected readonly _isBadge = true;
}
