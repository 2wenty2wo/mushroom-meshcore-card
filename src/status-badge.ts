import { hasAction, HeaderActionController } from "./actions.js";
import { computeCssColor, escapeHtml } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import {
  buildStatusSnapshot,
  statusOptionsFromConfig,
  type StatusFinding,
  type StatusFindingKind,
  type StatusRadioFaultCode,
  type StatusSnapshot,
  type StatusUnknownCheck,
} from "./status-model.js";
import { statusBadgeSummary } from "./status-summary.js";
import {
  STATUS_DIALOG_TAG,
  statusDialogImport,
  type StatusDialogParams,
  type StatusDialogRow,
  type StatusDialogSection,
} from "./status-dialog.js";
import type {
  HomeAssistant,
  MeshcoreStatusBadgeConfig,
} from "./types.js";

const RENDER_THROTTLE_MS = 10_000;

const BADGE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    display: inline-block;
    color: var(--primary-text-color, #212121);
    font-family: var(--primary-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif);
  }
  .status-badge-button {
    position: relative;
    display: inline-flex;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--ha-badge-border-radius, 18px);
    background: transparent;
    color: inherit;
    font: inherit;
    appearance: none;
    cursor: pointer;
    overflow: hidden;
  }
  .status-badge-button:focus-visible {
    outline: 2px solid var(--badge-color, var(--primary-color, var(--info-color, #03a9f4)));
    outline-offset: 2px;
  }
  ha-badge {
    max-width: min(100%, 320px);
    --badge-color: var(--status-badge-color, var(--secondary-text-color, #727272));
  }
  .status-badge-button > ha-ripple {
    border-radius: inherit;
    --ha-ripple-color: var(--status-badge-color, var(--secondary-text-color, #727272));
    --ha-ripple-hover-opacity: 0.04;
    --ha-ripple-pressed-opacity: 0.12;
  }
  ha-badge:not(:defined) {
    display: inline-flex;
    height: var(--ha-badge-size, 36px);
    min-width: var(--ha-badge-size, 36px);
    max-width: min(100%, 320px);
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    overflow: hidden;
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
    border-radius: var(--ha-badge-border-radius, 18px);
    background: var(--ha-card-background, var(--card-background-color, white));
    white-space: nowrap;
  }
  ha-badge > ha-icon[slot="icon"] {
    flex: 0 0 auto;
    color: var(--status-badge-color, var(--secondary-text-color, #727272));
    --mdc-icon-size: var(--ha-badge-icon-size, 18px);
  }
  .status-badge-state {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-badge-button.critical { --status-badge-color: var(--error-color, #f44336); }
  .status-badge-button.warning { --status-badge-color: var(--warning-color, #ff9800); }
  .status-badge-button.unknown { --status-badge-color: var(--secondary-text-color, #727272); }
  .status-badge-button.healthy { --status-badge-color: var(--status-badge-healthy-color, var(--success-color, #4caf50)); }
  .status-badge-button.unconfigured { cursor: default; --status-badge-color: var(--secondary-text-color, #727272); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
`;

export { statusBadgeSummary };

/** Add category counts for assistive technology without crowding the badge. */
export function statusBadgeAccessibleSummary(
  snapshot: StatusSnapshot,
  t: LocalizeFunc
): string {
  const summary = statusBadgeSummary(snapshot, t);
  const breakdown = snapshot.groups.map(
    (group) => `${findingGroupTitle(group.kind, t)}: ${group.items.length}`
  );
  if (snapshot.unknownCount > 0) {
    breakdown.push(
      `${t("card.status_unknown_checks")}: ${snapshot.unknownCount}`
    );
  }
  return breakdown.length > 0 ? `${summary} · ${breakdown.join(" · ")}` : summary;
}

function findingGroupTitle(kind: StatusFindingKind, t: LocalizeFunc): string {
  const keys: Record<StatusFindingKind, string> = {
    hub_offline: "card.status_hub_group",
    node_offline: "card.status_offline_nodes",
    mqtt_disconnected: "card.status_mqtt_connections",
    low_battery: "card.status_low_batteries",
    radio_fault: "card.status_radio_faults",
  };
  return t(keys[kind]);
}

function radioLabel(code: StatusRadioFaultCode | undefined, t: LocalizeFunc): string {
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

function findingRow(finding: StatusFinding, t: LocalizeFunc): StatusDialogRow {
  let name = finding.subject.name;
  let detail: string | undefined;
  switch (finding.kind) {
    case "hub_offline":
      detail = t("card.status_hub_offline");
      break;
    case "node_offline":
      name = t("card.status_node_offline", { name: finding.subject.name });
      break;
    case "mqtt_disconnected":
      name = t("card.status_mqtt_disconnected", { name: finding.subject.name });
      break;
    case "low_battery":
      detail = t("card.status_battery_value", {
        value: finding.value ?? "—",
      });
      break;
    case "radio_fault":
      name = radioLabel(finding.radioCode, t);
      detail = t("card.status_recorded_since_restart");
      break;
  }
  return {
    id: finding.id,
    name,
    detail,
    entityId: finding.entityId,
    severity: finding.severity,
  };
}

function unknownRow(check: StatusUnknownCheck, t: LocalizeFunc): StatusDialogRow {
  let name = check.subject.name;
  let detail: string | undefined = t("card.status_unknown");
  if (check.kind === "node_status") {
    name = t("card.status_node_unknown", { name: check.subject.name });
    detail = undefined;
  } else if (check.kind === "battery_status") {
    detail = `${t("card.battery_label")} · ${t("card.status_unknown")}`;
  } else if (check.kind === "radio_status") {
    name = radioLabel(check.radioCode, t);
  }
  return {
    id: check.id,
    name,
    detail,
    entityId: check.entityId,
    severity: "unknown",
  };
}

/** Convert the shared semantic snapshot into the dialog's localized view DTO. */
export function statusDialogSections(
  snapshot: StatusSnapshot,
  t: LocalizeFunc
): StatusDialogSection[] {
  const issueSections = snapshot.groups.map((group) => ({
    id: group.id,
    title: findingGroupTitle(group.kind, t),
    severity: group.severity,
    rows: group.items.map((finding) => findingRow(finding, t)),
  }));
  if (snapshot.unknownChecks.length === 0) return issueSections;
  return [
    ...issueSections,
    {
      id: "unknown_checks",
      title: t("card.status_unknown_checks"),
      severity: "unknown" as const,
      rows: snapshot.unknownChecks.map((check) => unknownRow(check, t)),
    },
  ];
}

export class MeshcoreStatusBadge extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreStatusBadgeConfig;
  private _snapshot: StatusSnapshot | null = null;
  private _lastRender = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _actions: HeaderActionController;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._actions = new HeaderActionController(
      this,
      () => this._hass,
      () => this._config,
      () => this._localize()("card.confirm_action"),
      () => this._showStatusDialog()
    );
    this.shadowRoot!.addEventListener("click", (event) => {
      this._actions.handleClick(event);
    });
    this.shadowRoot!.addEventListener("pointerdown", (event) => {
      this._actions.handlePointerDown(event);
    });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
      this.shadowRoot!.addEventListener(eventName, () => {
        this._actions.handlePointerEnd();
      });
    }
  }

  public connectedCallback(): void {
    this._render();
  }

  public disconnectedCallback(): void {
    if (this._renderTimer !== null) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    this._actions.disconnect();
  }

  public setConfig(config: MeshcoreStatusBadgeConfig): void {
    this._config = {
      ...config,
      excluded_nodes: Array.isArray(config.excluded_nodes)
        ? [...config.excluded_nodes]
        : undefined,
    };
    this._lastRender = 0;
    this._render();
  }

  public set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._scheduleRender();
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _scheduleRender(): void {
    const now = Date.now();
    if (now - this._lastRender >= RENDER_THROTTLE_MS) {
      this._lastRender = now;
      this._render();
      return;
    }
    if (this._renderTimer !== null) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this._lastRender = Date.now();
      this._render();
    }, RENDER_THROTTLE_MS - (now - this._lastRender));
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const t = this._localize();
    const target = this._config?.target;
    if (
      !this._hass ||
      !target ||
      target.type !== "hub" ||
      typeof target.id !== "string" ||
      !target.id.trim()
    ) {
      this._snapshot = null;
      this._renderUnavailable(t("card.status_select_hub_prompt"));
      return;
    }

    const snapshot = buildStatusSnapshot(
      this._hass,
      target.id,
      statusOptionsFromConfig(this._config)
    );
    if (!snapshot) {
      this._snapshot = null;
      this._renderUnavailable(
        t("card.status_target_not_found", { id: target.id })
      );
      return;
    }

    this._snapshot = snapshot;
    const name = this._config?.name || snapshot.hub.name;
    const summary = statusBadgeSummary(snapshot, t);
    const accessibleSummary = statusBadgeAccessibleSummary(snapshot, t);
    const opensDialog = this._config?.tap_action === undefined;
    const accessibleLabel = opensDialog
      ? t("card.status_open_details", { name, summary: accessibleSummary })
      : `${name}, ${accessibleSummary}`;
    const icon = this._config?.icon || "mdi:access-point-network";
    const configuredColor =
      snapshot.severity === "healthy" && this._config?.icon_color
        ? computeCssColor(this._config.icon_color)
        : null;
    const colorStyle = configuredColor
      ? ` style="--status-badge-healthy-color:${escapeHtml(configuredColor)}"`
      : "";
    const interactive =
      opensDialog ||
      hasAction(this._config?.tap_action) ||
      hasAction(this._config?.hold_action) ||
      hasAction(this._config?.double_tap_action);
    const tag = interactive ? "button" : "span";
    const actionAttributes = interactive
      ? `type="button" data-action-scope="badge" data-entity="${escapeHtml(
          snapshot.hub.primaryEntityId
        )}" aria-label="${escapeHtml(accessibleLabel)}"${
          opensDialog ? ' aria-haspopup="dialog"' : ""
        }`
      : `role="status" aria-label="${escapeHtml(
          `${name}, ${accessibleSummary}`
        )}"`;

    root.innerHTML = `<style>${BADGE_STYLES}</style>
      <${tag} class="status-badge-button ${snapshot.severity}" ${actionAttributes}${colorStyle}>
        ${interactive ? "<ha-ripple></ha-ripple>" : ""}
        <ha-badge label="${escapeHtml(name)}">
          <ha-icon slot="icon" icon="${escapeHtml(icon)}"></ha-icon>
          <span class="status-badge-state">${escapeHtml(summary)}</span>
        </ha-badge>
      </${tag}>`;
  }

  private _renderUnavailable(message: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    const t = this._localize();
    root.innerHTML = `<style>${BADGE_STYLES}</style>
      <span class="status-badge-button unconfigured" role="status">
        <ha-badge label="${escapeHtml(t("card.status_title"))}">
          <ha-icon slot="icon" icon="mdi:help-circle-outline"></ha-icon>
          <span class="status-badge-state">${escapeHtml(message)}</span>
        </ha-badge>
      </span>`;
  }

  private _showStatusDialog(): void {
    const snapshot = this._snapshot;
    const trigger = this._currentBadgeButton();
    if (!snapshot || !trigger) return;
    const t = this._localize();
    const name = this._config?.name || snapshot.hub.name;
    const params: StatusDialogParams = {
      title: t("card.status_dialog_title", { name }),
      sections: statusDialogSections(snapshot, t),
      emptyLabel: t("card.status_no_active_issues"),
      closeLabel: t("card.status_dialog_close"),
      returnFocus: trigger,
      resolveReturnFocus: () => this._currentBadgeButton(),
    };
    this.dispatchEvent(
      new CustomEvent("show-dialog", {
        bubbles: true,
        composed: true,
        detail: {
          dialogTag: STATUS_DIALOG_TAG,
          dialogImport: statusDialogImport,
          dialogParams: params,
          dialogAnchor: trigger,
        },
      })
    );
  }

  private _currentBadgeButton(): HTMLButtonElement | undefined {
    return (
      this.shadowRoot?.querySelector<HTMLButtonElement>(
        ".status-badge-button[data-action-scope]"
      ) ?? undefined
    );
  }

  public static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-status-badge-editor");
  }

  public static getStubConfig(): MeshcoreStatusBadgeConfig {
    return {};
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mushroom-meshcore-status-badge": MeshcoreStatusBadge;
  }
}
