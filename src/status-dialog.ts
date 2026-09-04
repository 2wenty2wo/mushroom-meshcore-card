import { escapeHtml } from "./helpers.js";

export const STATUS_DIALOG_TAG = "mushroom-meshcore-status-dialog";

export type StatusDialogSeverity =
  | "critical"
  | "warning"
  | "unknown"
  | "healthy";

export interface StatusDialogRow {
  id: string;
  name: string;
  detail?: string;
  entityId?: string | null;
  severity: StatusDialogSeverity;
}

export interface StatusDialogSection {
  id: string;
  title: string;
  severity: StatusDialogSeverity;
  rows: readonly StatusDialogRow[];
}

export interface StatusDialogParams {
  title: string;
  sections: readonly StatusDialogSection[];
  emptyLabel: string;
  closeLabel: string;
  returnFocus?: HTMLElement;
  resolveReturnFocus?: () => HTMLElement | undefined;
}

interface AdaptiveDialogElement extends HTMLElement {
  open: boolean;
  width: "small" | "medium" | "large" | "full";
  headerTitle?: string;
}

function deepestActiveElement(): HTMLElement | undefined {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active instanceof HTMLElement ? active : undefined;
}

function iconForSeverity(severity: StatusDialogSeverity): string {
  switch (severity) {
    case "critical":
      return "mdi:alert-circle";
    case "warning":
      return "mdi:alert";
    case "unknown":
      return "mdi:help-circle";
    case "healthy":
    default:
      return "mdi:check-circle";
  }
}

function renderRow(row: StatusDialogRow): string {
  const content = `<span class="status-dialog-icon ${row.severity}" aria-hidden="true"><ha-icon icon="${escapeHtml(
    iconForSeverity(row.severity)
  )}"></ha-icon></span>
    <span class="status-dialog-info">
      <span class="status-dialog-name">${escapeHtml(row.name)}</span>
      ${
        row.detail
          ? `<span class="status-dialog-detail">${escapeHtml(row.detail)}</span>`
          : ""
      }
    </span>`;

  if (!row.entityId) {
    return `<li class="status-dialog-row" data-row-id="${escapeHtml(
      row.id
    )}">${content}</li>`;
  }
  return `<li><button type="button" class="status-dialog-row actionable" data-row-id="${escapeHtml(
    row.id
  )}" data-entity="${escapeHtml(row.entityId)}">${content}<ha-icon class="status-dialog-open" icon="mdi:chevron-right" aria-hidden="true"></ha-icon><ha-ripple></ha-ripple></button></li>`;
}

function renderContent(params: StatusDialogParams): string {
  if (params.sections.length === 0) {
    return `<div class="status-dialog-empty"><ha-icon icon="mdi:check-circle-outline" aria-hidden="true"></ha-icon><span>${escapeHtml(
      params.emptyLabel
    )}</span></div>`;
  }

  return params.sections
    .filter((section) => section.rows.length > 0)
    .map(
      (section) => `<section class="status-dialog-section" data-section-id="${escapeHtml(
        section.id
      )}">
        <h3>${escapeHtml(section.title)}</h3>
        <ul>${section.rows.map(renderRow).join("")}</ul>
      </section>`
    )
    .join("");
}

const DIALOG_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    color: var(--primary-text-color, #212121);
    font-family: var(--primary-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif);
    --mushroom-meshcore-icon-size: var(--mush-icon-size, 36px);
    --mushroom-meshcore-icon-symbol-size: var(--mush-icon-symbol-size, 0.667em);
    --mushroom-meshcore-icon-radius: var(--mush-icon-border-radius, 50%);
    --mushroom-meshcore-control-height: var(--mush-control-height, 42px);
    --mushroom-meshcore-control-radius: var(--mush-control-border-radius, 12px);
  }
  .status-dialog-content {
    min-width: 0;
    max-height: min(70vh, 640px);
    overflow: auto;
    padding: var(--mush-spacing, 10px);
  }
  .status-dialog-section + .status-dialog-section {
    margin-top: var(--mush-spacing, 10px);
    padding-top: var(--mush-spacing, 10px);
    border-top: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
  }
  .status-dialog-section h3 {
    margin: 0 0 calc(var(--mush-spacing, 10px) / 2);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .status-dialog-section ul {
    display: grid;
    gap: calc(var(--mush-spacing, 10px) / 2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .status-dialog-row {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: var(--mushroom-meshcore-control-height);
    align-items: center;
    gap: var(--mush-spacing, 10px);
    margin: 0;
    padding: 3px var(--mush-spacing, 10px);
    border: 0;
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface, var(--ha-card-background, var(--card-background-color, white)));
    color: inherit;
    font: inherit;
    text-align: start;
    appearance: none;
  }
  button.status-dialog-row { cursor: pointer; overflow: hidden; }
  button.status-dialog-row:focus-visible {
    outline: 2px solid var(--primary-color, var(--info-color, #03a9f4));
    outline-offset: 2px;
  }
  .status-dialog-icon {
    display: inline-flex;
    width: var(--mushroom-meshcore-icon-size);
    height: var(--mushroom-meshcore-icon-size);
    flex: 0 0 var(--mushroom-meshcore-icon-size);
    align-items: center;
    justify-content: center;
    border-radius: var(--mushroom-meshcore-icon-radius);
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-icon-size);
  }
  .status-dialog-icon ha-icon {
    display: flex;
    line-height: 0;
    --mdc-icon-size: var(--mushroom-meshcore-icon-symbol-size);
  }
  .status-dialog-icon.critical {
    background: rgba(var(--mush-rgb-danger, var(--rgb-danger, 244, 67, 54)), 0.2);
    color: var(--error-color, rgb(var(--mush-rgb-danger, var(--rgb-danger, 244, 67, 54))));
  }
  .status-dialog-icon.warning {
    background: rgba(var(--mush-rgb-warning, var(--rgb-warning, 255, 152, 0)), 0.2);
    color: var(--warning-color, rgb(var(--mush-rgb-warning, var(--rgb-warning, 255, 152, 0))));
  }
  .status-dialog-info { display: flex; min-width: 0; flex: 1; flex-direction: column; }
  .status-dialog-name {
    overflow-wrap: anywhere;
    font-size: var(--mushroom-meshcore-primary-font-size, var(--mush-card-primary-font-size, 14px));
    font-weight: var(--mushroom-meshcore-primary-font-weight, var(--mush-card-primary-font-weight, 500));
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing, var(--mush-card-primary-letter-spacing, 0.1px));
    line-height: var(--mushroom-meshcore-primary-line-height, var(--mush-card-primary-line-height, 20px));
  }
  .status-dialog-detail {
    overflow-wrap: anywhere;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .status-dialog-open { flex: 0 0 auto; color: var(--secondary-text-color, #727272); --mdc-icon-size: 18px; }
  .status-dialog-row ha-ripple { --ha-ripple-hover-opacity: 0.04; }
  .status-dialog-empty {
    display: flex;
    min-height: 72px;
    align-items: center;
    justify-content: center;
    gap: var(--mush-spacing, 10px);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .status-dialog-empty ha-icon { color: var(--success-color, #4caf50); --mdc-icon-size: 20px; }
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-width: 100%;
    max-height: min(80vh, 720px);
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
    border-radius: var(--ha-dialog-border-radius, var(--ha-card-border-radius, 12px));
    background: var(--ha-dialog-surface-background, var(--card-background-color, white));
    color: var(--primary-text-color, #212121);
  }
  dialog::backdrop { background: var(--ha-dialog-scrim-color, rgba(0, 0, 0, 0.32)); }
  dialog .status-dialog-content { max-height: calc(min(80vh, 720px) - 56px); }
  .fallback-header {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 0 var(--mush-spacing, 10px);
    border-bottom: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
  }
  .fallback-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-size: 20px;
    font-weight: 500;
    line-height: 28px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fallback-close {
    display: inline-flex;
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--secondary-text-color, #727272);
    font: inherit;
    font-size: 26px;
    line-height: 1;
    appearance: none;
    cursor: pointer;
  }
  .fallback-close:focus-visible {
    outline: 2px solid var(--primary-color, var(--info-color, #03a9f4));
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
`;

export class MushroomMeshcoreStatusDialog extends HTMLElement {
  public readonly dialogNext = true as const;

  private _params?: StatusDialogParams;
  private _adaptiveDialog?: AdaptiveDialogElement;
  private _fallbackDialog?: HTMLDialogElement;
  private _returnFocus?: HTMLElement;
  private _restoreFocusOnClose = true;
  private _closed = false;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.addEventListener("click", (event) =>
      this._handleClick(event)
    );
  }

  public get params(): StatusDialogParams | undefined {
    return this._params;
  }

  public set params(value: StatusDialogParams | undefined) {
    this._params = value;
    this._closed = false;
    if (value && this.isConnected) this._render(value);
  }

  public showDialog(params: StatusDialogParams): void {
    this.params = params;
  }

  public connectedCallback(): void {
    if (this._params) this._render(this._params);
  }

  public closeDialog(): boolean {
    if (this._closed) return true;
    if (this._adaptiveDialog) {
      this._adaptiveDialog.open = false;
      return true;
    }
    if (this._fallbackDialog) {
      if (
        this._fallbackDialog.open &&
        typeof this._fallbackDialog.close === "function"
      ) {
        this._fallbackDialog.close();
      } else {
        this._finishClose();
      }
      return true;
    }
    this._finishClose();
    return true;
  }

  private _render(params: StatusDialogParams): void {
    this._returnFocus = params.returnFocus ?? deepestActiveElement();
    this._restoreFocusOnClose = true;
    this._adaptiveDialog = undefined;
    this._fallbackDialog = undefined;
    this.shadowRoot!.innerHTML = `<style>${DIALOG_STYLES}</style>`;

    const content = `<div class="status-dialog-content">${renderContent(
      params
    )}</div>`;
    if (customElements.get("ha-adaptive-dialog")) {
      const dialog = document.createElement(
        "ha-adaptive-dialog"
      ) as AdaptiveDialogElement;
      dialog.width = "small";
      dialog.headerTitle = params.title;
      dialog.innerHTML = content;
      dialog.addEventListener("closed", () => this._finishClose(), {
        once: true,
      });
      this.shadowRoot!.appendChild(dialog);
      this._adaptiveDialog = dialog;
      dialog.open = true;
      return;
    }

    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "status-dialog-title");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<div class="fallback-header">
      <div class="fallback-title" id="status-dialog-title">${escapeHtml(
        params.title
      )}</div>
      <button type="button" class="fallback-close" aria-label="${escapeHtml(
        params.closeLabel
      )}" title="${escapeHtml(params.closeLabel)}"><span aria-hidden="true">&times;</span></button>
    </div>${content}`;
    dialog
      .querySelector(".fallback-close")
      ?.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeDialog();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) this.closeDialog();
    });
    dialog.addEventListener("close", () => this._finishClose(), { once: true });
    this.shadowRoot!.appendChild(dialog);
    this._fallbackDialog = dialog;

    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
    Promise.resolve().then(() =>
      dialog.querySelector<HTMLElement>(".fallback-close")?.focus()
    );
  }

  private _handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const entityControl = target?.closest<HTMLElement>("[data-entity]");
    const entityId = entityControl?.dataset["entity"];
    if (!entityId) return;
    // This close transitions directly into Home Assistant's more-info modal.
    // Do not let a later adaptive-dialog `closed` event move focus behind the
    // newly opened modal and back to the badge.
    this._restoreFocusOnClose = false;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
    this.closeDialog();
  }

  private _finishClose(): void {
    if (this._closed) return;
    this._closed = true;
    let returnFocus = this._returnFocus;
    try {
      const currentReturnFocus = this._params?.resolveReturnFocus?.();
      if (currentReturnFocus?.isConnected) returnFocus = currentReturnFocus;
    } catch {
      // Fall back to the control captured when the dialog opened.
    }
    this.dispatchEvent(
      new CustomEvent("dialog-closed", {
        bubbles: true,
        composed: true,
        detail: { dialog: STATUS_DIALOG_TAG },
      })
    );
    this.remove();
    if (this._restoreFocusOnClose && returnFocus?.isConnected) {
      try {
        returnFocus.focus();
      } catch {
        // A removed or inert source control cannot receive focus.
      }
    }
  }
}

export function ensureStatusDialog(): void {
  if (!customElements.get(STATUS_DIALOG_TAG)) {
    customElements.define(STATUS_DIALOG_TAG, MushroomMeshcoreStatusDialog);
  }
}

export function statusDialogImport(): Promise<void> {
  ensureStatusDialog();
  return Promise.resolve();
}

declare global {
  interface HTMLElementTagNameMap {
    "mushroom-meshcore-status-dialog": MushroomMeshcoreStatusDialog;
  }
}
