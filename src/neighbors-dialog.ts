import { escapeHtml } from "./helpers.js";
import type { LocalizeFunc } from "./localize.js";
import {
  NEIGHBOR_STYLES,
  renderNeighborSection,
  type NeighborSnapshot,
} from "./neighbors.js";

export const NEIGHBORS_DIALOG_TAG = "mushroom-meshcore-neighbors-dialog";

export interface NeighborsDialogParams {
  title: string;
  snapshot: NeighborSnapshot;
  maxNeighbors?: number;
  localize: LocalizeFunc;
  closeLabel: string;
}

interface AdaptiveDialogElement extends HTMLElement {
  open: boolean;
  width: "small" | "medium" | "large" | "full";
  headerTitle?: string;
}

const DIALOG_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    color: var(--primary-text-color, #212121);
    font-family: var(--primary-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif);
  }
  .neighbors-dialog-content { min-width: 0; }
  .neighbors-dialog-content .neighbors-section { margin-top: 0; }
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
  dialog::backdrop {
    background: var(--ha-dialog-scrim-color, rgba(0, 0, 0, 0.32));
  }
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
  .fallback-close:hover { background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.04); }
  .fallback-close:focus-visible {
    outline: 2px solid var(--primary-color, var(--info-color, #03a9f4));
    outline-offset: 2px;
  }
  .fallback-body {
    max-height: calc(min(80vh, 720px) - 56px);
    overflow: auto;
    padding: var(--mush-spacing, 10px);
  }
`;

export class MushroomMeshcoreNeighborsDialog extends HTMLElement {
  public readonly dialogNext = true as const;

  private _params?: NeighborsDialogParams;
  private _adaptiveDialog?: AdaptiveDialogElement;
  private _fallbackDialog?: HTMLDialogElement;
  private _closed = false;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.addEventListener("click", (event) => this._handleClick(event));
  }

  public get params(): NeighborsDialogParams | undefined {
    return this._params;
  }

  public set params(value: NeighborsDialogParams | undefined) {
    this._params = value;
    this._closed = false;
    if (value && this.isConnected) this._render(value);
  }

  // Compatibility with Home Assistant's legacy persistent-dialog lifecycle.
  public showDialog(params: NeighborsDialogParams): void {
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
      if (this._fallbackDialog.open && typeof this._fallbackDialog.close === "function") {
        this._fallbackDialog.close();
      } else {
        this._finishClose();
      }
      return true;
    }

    this._finishClose();
    return true;
  }

  private _render(params: NeighborsDialogParams): void {
    const content = renderNeighborSection(
      params.snapshot,
      params.localize,
      params.maxNeighbors
    );

    this._adaptiveDialog = undefined;
    this._fallbackDialog = undefined;
    this.shadowRoot!.innerHTML = `<style>${DIALOG_STYLES}${NEIGHBOR_STYLES}</style>`;

    if (customElements.get("ha-adaptive-dialog")) {
      const dialog = document.createElement("ha-adaptive-dialog") as AdaptiveDialogElement;
      dialog.width = "small";
      dialog.headerTitle = params.title;
      dialog.innerHTML = `<div class="neighbors-dialog-content">${content}</div>`;
      dialog.addEventListener("closed", () => this._finishClose(), { once: true });
      this.shadowRoot!.appendChild(dialog);
      this._adaptiveDialog = dialog;
      dialog.open = true;
      return;
    }

    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "neighbors-dialog-title");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<div class="fallback-header">
      <div class="fallback-title" id="neighbors-dialog-title">${escapeHtml(params.title)}</div>
      <button type="button" class="fallback-close" aria-label="${escapeHtml(params.closeLabel)}" title="${escapeHtml(params.closeLabel)}"><span aria-hidden="true">&times;</span></button>
    </div>
    <div class="fallback-body neighbors-dialog-content">${content}</div>`;
    dialog.querySelector(".fallback-close")?.addEventListener("click", () => this.closeDialog());
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
  }

  private _handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const entityControl = target?.closest<HTMLElement>("[data-entity]");
    const entityId = entityControl?.dataset["entity"];
    if (!entityId) return;

    this.dispatchEvent(new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  private _finishClose(): void {
    if (this._closed) return;
    this._closed = true;
    this.dispatchEvent(new CustomEvent("dialog-closed", {
      bubbles: true,
      composed: true,
      detail: { dialog: NEIGHBORS_DIALOG_TAG },
    }));
    this.remove();
  }
}

export function ensureNeighborsDialog(): void {
  if (!customElements.get(NEIGHBORS_DIALOG_TAG)) {
    customElements.define(NEIGHBORS_DIALOG_TAG, MushroomMeshcoreNeighborsDialog);
  }
}

/** A resolved loader matching Home Assistant's `show-dialog` contract. */
export function neighborsDialogImport(): Promise<void> {
  ensureNeighborsDialog();
  return Promise.resolve();
}

declare global {
  interface HTMLElementTagNameMap {
    "mushroom-meshcore-neighbors-dialog": MushroomMeshcoreNeighborsDialog;
  }
}
