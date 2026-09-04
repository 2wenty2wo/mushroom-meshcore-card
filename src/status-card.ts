import type {
  HomeAssistant,
  MeshcoreStatusCardConfig,
} from "./types.js";
import { handleAction, HeaderActionController } from "./actions.js";
import { discoverHubs } from "./discovery.js";
import { escapeHtml, formatLastSeen } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import {
  buildStatusSnapshot,
  statusOptionsFromConfig,
  type StatusDiagnostic,
  type StatusFinding,
  type StatusFindingGroup,
  type StatusFindingKind,
  type StatusNode,
  type StatusRadioFaultCode,
  type StatusSeverity,
  type StatusSnapshot,
  type StatusUnknownCheck,
} from "./status-model.js";
import { statusCardSummary } from "./status-summary.js";
import { STATUS_CARD_STYLES } from "./status-styles.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";

const DISCLOSURE_MONITORED = "monitored-nodes";
const DISCLOSURE_DIAGNOSTICS = "diagnostics";
type StatusRowTone = StatusSeverity | "neutral";

function iconForFinding(kind: StatusFindingKind): string {
  switch (kind) {
    case "hub_offline":
      return "mdi:access-point-network-off";
    case "node_offline":
      return "mdi:signal-off";
    case "mqtt_disconnected":
      return "mdi:lan-disconnect";
    case "low_battery":
      return "mdi:battery-alert";
    case "radio_fault":
      return "mdi:alert-circle-outline";
  }
}

function iconForConnectivity(state: StatusNode["state"]): string {
  if (state === "online") return "mdi:check";
  if (state === "offline") return "mdi:signal-off";
  return "mdi:help";
}

function radioFaultLabel(code: StatusRadioFaultCode | undefined, t: LocalizeFunc): string {
  switch (code) {
    case "err_pool_full":
      return t("card.status_radio_pool_full");
    case "err_cad_timeout":
      return t("card.status_radio_cad_timeout");
    case "err_rx_timeout":
      return t("card.status_radio_rx_timeout");
    default:
      return t("card.status_radio_faults");
  }
}

function findingGroupLabel(kind: StatusFindingKind, t: LocalizeFunc): string {
  switch (kind) {
    case "hub_offline":
      return t("card.status_hub_group");
    case "node_offline":
      return t("card.status_offline_nodes");
    case "mqtt_disconnected":
      return t("card.status_mqtt_connections");
    case "low_battery":
      return t("card.status_low_batteries");
    case "radio_fault":
      return t("card.status_radio_faults");
  }
}

function severityClass(severity: StatusRowTone): string {
  return severity === "healthy" ? "healthy" : severity;
}

export class MeshcoreStatusCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreStatusCardConfig;
  private _stateFingerprint = "";
  private _lastRender = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _cardSize = 2;
  private _openDisclosures = new Set<string>();
  private _disclosuresSeeded = false;
  private readonly _headerActions: HeaderActionController;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._headerActions = new HeaderActionController(
      this,
      () => this._hass,
      () => this._config,
      () => this._localize()("card.confirm_action")
    );
    this.shadowRoot!.addEventListener("click", (event: Event) => {
      if (this._headerActions.handleClick(event)) return;
      const row = (event.target as Element).closest?.(
        "[data-entity]"
      ) as HTMLElement | null;
      const entityId = row?.dataset["entity"];
      if (entityId) {
        handleAction(
          this,
          this._hass,
          { action: "more-info" },
          entityId,
          this._localize()("card.confirm_action")
        );
      }
    });
    this.shadowRoot!.addEventListener("pointerdown", (event: Event) => {
      this._headerActions.handlePointerDown(event);
    });
    for (const type of ["pointerup", "pointercancel"]) {
      this.shadowRoot!.addEventListener(type, () => {
        this._headerActions.handlePointerEnd();
      });
    }
    this.shadowRoot!.addEventListener(
      "toggle",
      (event: Event) => {
        const disclosure = event.target as HTMLDetailsElement;
        const id = disclosure.dataset?.["disclosure"];
        if (disclosure.tagName !== "DETAILS" || !id) return;
        if (disclosure.open) this._openDisclosures.add(id);
        else this._openDisclosures.delete(id);
      },
      true
    );
  }

  connectedCallback(): void {
    this._connected = true;
    if (this._tickTimer === null) {
      this._tickTimer = setInterval(() => this._render(), 60000);
    }
    this._render();
  }

  disconnectedCallback(): void {
    this._connected = false;
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    if (this._renderTimer !== null) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    this._headerActions.disconnect();
  }

  setConfig(config: MeshcoreStatusCardConfig): void {
    const previous = this._config;
    this._config = { ...config };
    if (
      previous?.target?.id !== config.target?.id ||
      previous?.monitored_nodes_default_open !==
        config.monitored_nodes_default_open ||
      previous?.diagnostics_default_open !== config.diagnostics_default_open
    ) {
      this._openDisclosures.clear();
      this._disclosuresSeeded = false;
    }
    this._stateFingerprint = "";
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const fingerprint = this._fingerprint();
    if (fingerprint === this._stateFingerprint) return;
    this._stateFingerprint = fingerprint;
    this._scheduleRender();
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _fingerprint(): string {
    const hass = this._hass;
    const config = this._config;
    if (!hass) return "";
    const configured = new Set(
      [config?.status_entity, config?.battery_entity].filter(
        (entityId): entityId is string => !!entityId
      )
    );
    const states = Object.entries(hass.states)
      .filter(([entityId]) => entityId.includes("meshcore") || configured.has(entityId))
      .map(
        ([entityId, state]) =>
          `${entityId}=${state.state}@${state.last_changed}@${state.last_updated}`
      )
      .sort();
    const registry = Object.entries(hass.entities)
      .filter(([, entry]) => entry.platform === "meshcore")
      .map(
        ([entityId, entry]) =>
          `${entityId}:${entry.device_id}:${entry.disabled_by ?? ""}`
      )
      .sort();
    const devices = Object.values(hass.devices)
      .map(
        (device) =>
          `${device.id}:${device.via_device_id ?? ""}:${device.name_by_user ?? device.name ?? ""}`
      )
      .sort();
    return JSON.stringify([
      hass.language ?? hass.locale?.language,
      config,
      states,
      registry,
      devices,
    ]);
  }

  private _scheduleRender(): void {
    const now = Date.now();
    if (now - this._lastRender >= 10000) {
      this._lastRender = now;
      this._render();
      return;
    }
    if (this._renderTimer !== null) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      if (!this._connected) return;
      this._lastRender = Date.now();
      this._render();
    }, 10000 - (now - this._lastRender));
  }

  private _seedDisclosures(): void {
    if (this._disclosuresSeeded) return;
    this._openDisclosures.clear();
    if (this._config?.monitored_nodes_default_open) {
      this._openDisclosures.add(DISCLOSURE_MONITORED);
    }
    if (this._config?.diagnostics_default_open) {
      this._openDisclosures.add(DISCLOSURE_DIAGNOSTICS);
    }
    this._disclosuresSeeded = true;
  }

  private _summary(snapshot: StatusSnapshot, t: LocalizeFunc): string {
    return statusCardSummary(snapshot, t);
  }

  private _groupTitle(group: StatusFindingGroup, t: LocalizeFunc): string {
    return findingGroupLabel(group.kind, t);
  }

  private _row(
    id: string,
    name: string,
    detail: string,
    icon: string,
    severity: StatusRowTone,
    entityId: string | null
  ): string {
    const content = `<span class="status-row-icon" aria-hidden="true"><ha-icon icon="${escapeHtml(
      icon
    )}"></ha-icon></span>
      <span class="status-row-copy">
        <span class="status-row-primary">${escapeHtml(name)}</span>
        ${detail ? `<span class="status-row-secondary">${escapeHtml(detail)}</span>` : ""}
      </span>
      ${entityId ? '<ha-icon icon="mdi:chevron-right" aria-hidden="true"></ha-icon>' : ""}`;
    if (!entityId) {
      return `<div class="status-row ${severityClass(
        severity
      )}" data-row-id="${escapeHtml(id)}">${content}</div>`;
    }
    return `<button type="button" class="status-row clickable ${severityClass(
      severity
    )}" data-row-id="${escapeHtml(id)}" data-entity="${escapeHtml(
      entityId
    )}" aria-label="${escapeHtml(`${name}, ${detail}`)}"><ha-ripple></ha-ripple>${content}</button>`;
  }

  private _findingRow(finding: StatusFinding, t: LocalizeFunc): string {
    let detail = "";
    if (finding.kind === "hub_offline") detail = t("card.status_hub_offline");
    else if (finding.kind === "node_offline") detail = t("card.offline");
    else if (finding.kind === "mqtt_disconnected") {
      detail = t("card.status_mqtt_disconnected", { name: finding.subject.name });
    } else if (finding.kind === "low_battery") {
      detail = t("card.status_battery_value", { value: String(finding.value ?? "") });
    } else if (finding.kind === "radio_fault") {
      detail = `${radioFaultLabel(finding.radioCode, t)} · ${t(
        "card.status_recorded_since_restart"
      )}`;
    }
    return this._row(
      finding.id,
      finding.subject.name,
      detail,
      iconForFinding(finding.kind),
      finding.severity,
      finding.entityId
    );
  }

  private _unknownRow(check: StatusUnknownCheck, t: LocalizeFunc): string {
    let detail = t("card.status_unknown");
    if (check.kind === "battery_status") {
      detail = `${t("card.battery_label")} · ${detail}`;
    } else if (check.kind === "mqtt_status") {
      detail = `${t("card.mqtt_label")} · ${detail}`;
    } else if (check.kind === "radio_status") {
      detail = `${radioFaultLabel(check.radioCode, t)} · ${detail}`;
    }
    return this._row(
      check.id,
      check.subject.name,
      detail,
      "mdi:help",
      "unknown",
      check.entityId
    );
  }

  private _renderFindings(snapshot: StatusSnapshot, t: LocalizeFunc): string {
    const groups = snapshot.groups
      .map((group) => {
        const only = group.items.length === 1 ? group.items[0] : undefined;
        if (only?.entityId) return this._findingRow(only, t);
        return this._issueDisclosure(
          `issue:${group.id}`,
          this._groupTitle(group, t),
          group.items.length,
          iconForFinding(group.kind),
          group.severity,
          group.items.map((finding) => this._findingRow(finding, t)).join("")
        );
      })
      .join("");
    const onlyUnknown =
      snapshot.unknownChecks.length === 1
        ? snapshot.unknownChecks[0]
        : undefined;
    const unknowns = onlyUnknown?.entityId
      ? this._unknownRow(onlyUnknown, t)
      : snapshot.unknownChecks.length
        ? this._issueDisclosure(
          "issue:unknown",
          t("card.status_unknown_checks"),
          snapshot.unknownChecks.length,
          "mdi:help-circle-outline",
          "unknown",
          snapshot.unknownChecks.map((check) => this._unknownRow(check, t)).join("")
          )
        : "";
    if (groups || unknowns) {
      return `<section class="status-findings"><h3 class="status-group-title">${escapeHtml(
        t("card.status_needs_attention")
      )}</h3><div class="status-issue-list">${groups}${unknowns}</div></section>`;
    }
    return `<div class="status-calm"><ha-icon icon="mdi:check-circle-outline" aria-hidden="true"></ha-icon><span>${escapeHtml(
      t("card.status_no_active_issues")
    )}</span></div>`;
  }

  private _issueDisclosure(
    id: string,
    title: string,
    count: number,
    icon: string,
    severity: StatusSeverity,
    body: string
  ): string {
    const open = this._openDisclosures.has(id) ? " open" : "";
    return `<details class="status-issue-disclosure ${severityClass(
      severity
    )}" data-disclosure="${escapeHtml(id)}"${open}>
      <summary>
        <span class="status-row-icon" aria-hidden="true"><ha-icon icon="${escapeHtml(
          icon
        )}"></ha-icon></span>
        <span class="status-row-copy"><span class="status-row-primary">${escapeHtml(
          `${title} (${count})`
        )}</span></span>
        <ha-icon class="status-disclosure-chevron" icon="mdi:chevron-down" aria-hidden="true"></ha-icon>
      </summary>
      <div class="status-list">${body}</div>
    </details>`;
  }

  private _nodeRow(node: StatusNode, t: LocalizeFunc): string {
    const parts = [
      node.state === "online"
        ? t("card.online")
        : node.state === "offline"
          ? t("card.offline")
          : t("card.unknown"),
    ];
    if (node.batteryPercent !== null) {
      parts.push(
        t("card.status_battery_value", { value: node.batteryPercent })
      );
    }
    const lastPoll = formatLastSeen(node.lastSuccessfulRequest, t);
    if (lastPoll) {
      parts.push(t("card.status_last_successful_poll", { time: lastPoll }));
    }
    return this._row(
      node.id,
      node.name,
      parts.join(" · "),
      iconForConnectivity(node.state),
      node.state === "online" ? "healthy" : node.state === "offline" ? "warning" : "unknown",
      node.entityId
    );
  }

  private _diagnosticLabel(diagnostic: StatusDiagnostic, t: LocalizeFunc): string {
    switch (diagnostic.metric) {
      case "tx_queue_len":
        return t("card.status_queue_length");
      case "request_failures":
        return t("card.request_failures_label");
      case "full_evts":
        return t("card.traffic_queue_full_events");
      case "recv_errors":
        return t("card.traffic_receive_errors");
      case "recv_errors_rate":
        return t("card.traffic_receive_errors_rate");
    }
  }

  private _diagnosticRow(diagnostic: StatusDiagnostic, t: LocalizeFunc): string {
    const value = `${diagnostic.value}${diagnostic.unit ? ` ${diagnostic.unit}` : ""}`;
    return this._row(
      diagnostic.id,
      diagnostic.subject.name,
      `${this._diagnosticLabel(diagnostic, t)}: ${value}`,
      "mdi:chart-line",
      "neutral",
      diagnostic.entityId
    );
  }

  private _disclosure(
    id: string,
    title: string,
    count: number,
    body: string
  ): string {
    const open = this._openDisclosures.has(id) ? " open" : "";
    return `<details class="status-disclosure" data-disclosure="${escapeHtml(
      id
    )}"${open}>
      <summary><span>${escapeHtml(title)}${count ? ` (${count})` : ""}</span><ha-icon icon="mdi:chevron-down" aria-hidden="true"></ha-icon></summary>
      <div class="status-disclosure-content">${body}</div>
    </details>`;
  }

  private _renderDisclosures(snapshot: StatusSnapshot, t: LocalizeFunc): string {
    let disclosures = "";
    if (!this._config?.hide_monitored_nodes && !snapshot.dependentChecksSuppressed) {
      const body = snapshot.nodes.items.length
        ? snapshot.nodes.items.map((node) => this._nodeRow(node, t)).join("")
        : `<div class="status-calm"><span>${escapeHtml(
            t("card.status_no_monitored_nodes")
          )}</span></div>`;
      disclosures += this._disclosure(
        DISCLOSURE_MONITORED,
        t("card.status_monitored_nodes"),
        snapshot.monitoredCount,
        body
      );
    }
    if (
      !this._config?.hide_diagnostics &&
      !snapshot.dependentChecksSuppressed
    ) {
      const hasCumulative = snapshot.diagnostics.some((diagnostic) =>
        ["request_failures", "full_evts", "recv_errors"].includes(
          diagnostic.metric
        )
      );
      const note = hasCumulative
        ? `<div class="status-row neutral"><span class="status-row-copy"><span class="status-row-secondary">${escapeHtml(
            t("card.status_cumulative_note")
          )}</span></span></div>`
        : "";
      disclosures += this._disclosure(
        DISCLOSURE_DIAGNOSTICS,
        t("card.status_diagnostics"),
        snapshot.diagnostics.length,
        snapshot.diagnostics.length
          ? snapshot.diagnostics
              .map((diagnostic) => this._diagnosticRow(diagnostic, t))
              .join("") + note
          : `<div class="status-calm"><span>${escapeHtml(
              t("card.status_no_diagnostics")
            )}</span></div>`
      );
    }
    return disclosures;
  }

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = this._localize();
    const target = this._config.target;
    if (
      target?.type !== "hub" ||
      typeof target.id !== "string" ||
      !target.id.trim()
    ) {
      this._cardSize = 1;
      this._setBody(
        `<div class="empty-status">${escapeHtml(
          t("card.status_select_hub_prompt")
        )}</div>`,
        null
      );
      return;
    }
    const discovered = discoverHubs(this._hass).some(
      (hub) => hub.pubkey === target.id
    );
    if (!discovered) {
      this._cardSize = 1;
      this._setBody(
        `<div class="empty-status">${escapeHtml(
          t("card.status_target_not_found", { id: target.id })
        )}</div>`,
        null
      );
      return;
    }
    const snapshot = buildStatusSnapshot(
      this._hass,
      target.id,
      statusOptionsFromConfig(this._config)
    );
    if (!snapshot) return;
    this._seedDisclosures();
    const summary = this._summary(snapshot, t);
    const headerConfig = {
      ...this._config,
      icon_color:
        snapshot.severity === "healthy" ? this._config.icon_color : undefined,
    };
    const header = renderTileHeader(headerConfig, {
      displayName: snapshot.hub.name || t("card.status_title"),
      secondary: summary,
      icon: "mdi:access-point-network",
      active: snapshot.severity !== "unknown",
      inactiveState: "unknown",
      inactiveBadgeIcon: "mdi:help",
      primaryEntityId: snapshot.hub.primaryEntityId,
    });
    const body = `<div class="status-body">${this._renderFindings(
      snapshot,
      t
    )}${this._renderDisclosures(snapshot, t)}</div>`;
    this._cardSize = Math.max(
      2,
      Math.min(10, 2 + snapshot.groups.length + (snapshot.unknownCount ? 1 : 0))
    );
    this._setBody(header + body, snapshot);
  }

  private _setBody(body: string, snapshot: StatusSnapshot | null): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const severity = snapshot?.severity ?? "unknown";
    this.shadowRoot!.innerHTML = `<style>${STATUS_CARD_STYLES}</style><ha-card class="status-card status-${escapeHtml(
      severity
    )}${constrained ? " grid-rows" : ""}">${body}</ha-card>`;
    hydrateTileInfo(this.shadowRoot!);
  }

  getCardSize(): number {
    return this._cardSize;
  }

  getGridOptions(): {
    columns: "full";
    rows: "auto";
    min_columns: number;
    min_rows: number;
  } {
    return {
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 2,
    };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-status-card-editor");
  }

  static getStubConfig(): MeshcoreStatusCardConfig {
    return {};
  }
}
