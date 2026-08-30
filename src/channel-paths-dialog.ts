import { escapeHtml } from "./helpers.js";
import type { LocalizeFunc } from "./localize.js";

export const CHANNEL_PATHS_DIALOG_TAG =
  "mushroom-meshcore-channel-paths-dialog";

export type ChannelPathHashSize = 1 | 2 | 3;

export interface ChannelMessagePathRoute {
  hopCount: number;
  pathSegments: readonly string[];
  hashSizeBytes?: ChannelPathHashSize;
  direct?: boolean;
}

export interface ChannelPathContact {
  publicKey: string;
  name: string;
  /** True when the key came from a legacy prefix rather than a full public key. */
  keyIsPrefix?: boolean;
}

export interface ChannelPathsDialogParams {
  title: string;
  routes: readonly ChannelMessagePathRoute[];
  contacts: readonly ChannelPathContact[];
  contactsPromise?: Promise<readonly ChannelPathContact[]>;
  localize: LocalizeFunc;
  closeLabel: string;
  returnFocus?: HTMLElement;
  resolveReturnFocus?: () => HTMLElement | undefined;
}

interface AdaptiveDialogElement extends HTMLElement {
  open: boolean;
  width: "small" | "medium" | "large" | "full";
  headerTitle?: string;
}

interface NormalizedPathRoute {
  hopCount: number;
  pathSegments: string[];
  hashSizeBytes?: ChannelPathHashSize;
  direct: boolean;
}

interface NormalizedPathContact {
  publicKey: string;
  name: string;
  keyIsPrefix: boolean;
}

const MAX_ROUTES = 64;
const MAX_HOPS = 64;
const MAX_CONTACTS = 1024;
const MAX_CONTACT_NAME_LENGTH = 512;

const DIALOG_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    color: var(--primary-text-color, #212121);
    font-family: var(--primary-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif);
  }
  .channel-paths-dialog-content {
    min-width: 0;
    max-height: min(70vh, 640px);
    overflow: auto;
    padding: var(--mush-spacing, 10px);
  }
  .paths-warning {
    margin: 0 0 var(--mush-spacing, 10px);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .message-path {
    min-width: 0;
    padding: var(--mush-spacing, 10px) 0;
    border-top: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
  }
  .message-path:last-child { padding-bottom: 0; }
  .message-path-title {
    margin: 0 0 calc(var(--mush-spacing, 10px) / 2);
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-primary-font-size, var(--mush-card-primary-font-size, 14px));
    font-weight: var(--mushroom-meshcore-primary-font-weight, var(--mush-card-primary-font-weight, 500));
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing, var(--mush-card-primary-letter-spacing, 0.1px));
    line-height: var(--mushroom-meshcore-primary-line-height, var(--mush-card-primary-line-height, 20px));
  }
  .message-path-hops {
    display: grid;
    min-width: 0;
    gap: calc(var(--mush-spacing, 10px) / 2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .message-path-hop {
    display: grid;
    min-width: 0;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: baseline;
    column-gap: calc(var(--mush-spacing, 10px) / 2);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .message-path-hash {
    direction: ltr;
    unicode-bidi: isolate;
    color: var(--primary-text-color, #212121);
    font-family: var(--code-font-family, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace);
    font-variant-numeric: tabular-nums;
  }
  .message-path-name { min-width: 0; overflow-wrap: anywhere; }
  .message-path-candidates {
    grid-column: 2;
    min-width: 0;
    margin: 2px 0 0;
    padding-inline-start: 18px;
    color: var(--secondary-text-color, #727272);
  }
  .message-path-candidate { overflow-wrap: anywhere; }
  .message-path-more { list-style: none; }
  .message-path-direct {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
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
  dialog .channel-paths-dialog-content {
    max-height: calc(min(80vh, 720px) - 56px);
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
  @media (max-width: 420px) {
    dialog { width: calc(100vw - 20px); }
    .channel-paths-dialog-content { padding: var(--mush-spacing, 10px); }
    .message-path-hop { grid-template-columns: 1fr; }
    .message-path-candidates { grid-column: 1; }
  }
`;

function normalizeRoute(route: ChannelMessagePathRoute): NormalizedPathRoute | null {
  if (!route || typeof route !== "object" || !Array.isArray(route.pathSegments)) {
    return null;
  }
  const hopCount = Number.isInteger(route.hopCount) && route.hopCount >= 0
    && route.hopCount <= MAX_HOPS
    ? route.hopCount
    : null;
  if (hopCount === null) return null;

  const direct = route.direct === true
    || (hopCount === 0 && route.pathSegments.length === 0);
  if (direct) {
    if (hopCount !== 0) return null;
    return { hopCount: 0, pathSegments: [], direct: true };
  }

  const width = route.hashSizeBytes;
  if (width !== 1 && width !== 2 && width !== 3) return null;
  if (!route.pathSegments.length || route.pathSegments.length > MAX_HOPS) return null;
  const tokenPattern = new RegExp(`^[0-9A-Fa-f]{${width * 2}}$`);
  const pathSegments = route.pathSegments.map((segment) => segment.trim());
  if (pathSegments.some((segment) => !tokenPattern.test(segment))) return null;

  return {
    hopCount,
    pathSegments: pathSegments.map((segment) => segment.toUpperCase()),
    hashSizeBytes: width,
    direct: false,
  };
}

function normalizedRoutes(
  routes: readonly ChannelMessagePathRoute[]
): NormalizedPathRoute[] {
  const result: NormalizedPathRoute[] = [];
  const seen = new Set<string>();
  for (const value of routes.slice(0, MAX_ROUTES)) {
    const route = normalizeRoute(value);
    if (!route) continue;
    const key = route.direct
      ? "direct"
      : `${route.hashSizeBytes}:${route.pathSegments.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(route);
  }
  return result;
}

function normalizeContacts(
  contacts: readonly ChannelPathContact[]
): NormalizedPathContact[] {
  const result: NormalizedPathContact[] = [];
  const seen = new Set<string>();
  for (const contact of contacts.slice(0, MAX_CONTACTS)) {
    if (!contact || typeof contact !== "object"
      || typeof contact.publicKey !== "string" || typeof contact.name !== "string") {
      continue;
    }
    const publicKey = contact.publicKey.trim().toUpperCase();
    const name = contact.name.trim();
    const keyIsPrefix = contact.keyIsPrefix === true;
    const identity = keyIsPrefix ? `${publicKey}\u0000${name}` : publicKey;
    if (!/^[0-9A-F]+$/.test(publicKey) || publicKey.length < 2
      || publicKey.length > 128 || publicKey.length % 2 !== 0
      || !name || name.length > MAX_CONTACT_NAME_LENGTH || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push({ publicKey, name, keyIsPrefix });
  }
  return result;
}

function mergeContacts(
  first: readonly NormalizedPathContact[],
  second: readonly NormalizedPathContact[]
): NormalizedPathContact[] {
  const merged = first.slice(0, MAX_CONTACTS);
  for (const contact of second) {
    const exactIndex = merged.findIndex((candidate) =>
      candidate.publicKey === contact.publicKey
        && (!candidate.keyIsPrefix || !contact.keyIsPrefix
          || candidate.name === contact.name)
    );
    if (exactIndex >= 0) {
      // The service response is fresher than the immediate state snapshot.
      merged[exactIndex] = contact;
      continue;
    }

    const matchingPrefixIndex = merged.findIndex((candidate) =>
      candidate.name === contact.name
        && (candidate.keyIsPrefix || contact.keyIsPrefix)
        && (candidate.publicKey.startsWith(contact.publicKey)
          || contact.publicKey.startsWith(candidate.publicKey))
    );
    if (matchingPrefixIndex >= 0) {
      // Legacy state attributes may contain only adv_id/pubkey_prefix. Avoid
      // counting that shorter representation and the full service key twice.
      if (contact.publicKey.length > merged[matchingPrefixIndex].publicKey.length) {
        merged[matchingPrefixIndex] = contact;
      }
      continue;
    }

    if (merged.length >= MAX_CONTACTS) break;
    merged.push(contact);
  }
  return merged;
}

function candidateContacts(
  token: string,
  contacts: readonly NormalizedPathContact[]
): NormalizedPathContact[] {
  return contacts.filter((contact) =>
    contact.publicKey.length >= token.length
      && contact.publicKey.slice(0, token.length) === token
  );
}

function countLabel(
  t: LocalizeFunc,
  count: number,
  oneKey: string,
  manyKey: string
): string {
  return t(count === 1 ? oneKey : manyKey, { n: count });
}

function renderHop(
  token: string,
  contacts: readonly NormalizedPathContact[],
  t: LocalizeFunc,
  index: number
): string {
  const candidates = candidateContacts(token, contacts);
  const hash = `<bdi class="message-path-hash" dir="ltr">${escapeHtml(token)}</bdi>`;
  if (candidates.length === 1) {
    return `<li class="message-path-hop" data-hop-index="${index}">${hash}<span class="message-path-name"><span>— </span><bdi>${escapeHtml(
      candidates[0].name
    )}</bdi></span></li>`;
  }
  if (!candidates.length) {
    return `<li class="message-path-hop" data-hop-index="${index}">${hash}<span class="message-path-name"><span>— </span>${escapeHtml(
      t("card.channel_unknown_repeater")
    )}</span></li>`;
  }

  const visibleCandidates = candidates.slice(0, 3);
  const remaining = candidates.length - visibleCandidates.length;
  const candidateItems = visibleCandidates.map((contact) =>
    `<li class="message-path-candidate"><bdi>${escapeHtml(contact.name)}</bdi></li>`
  );
  if (remaining > 0) {
    candidateItems.push(`<li class="message-path-more">${escapeHtml(
      t("card.channel_candidates_more", { n: remaining })
    )}</li>`);
  }
  return `<li class="message-path-hop" data-hop-index="${index}">${hash}<span class="message-path-name"><span>— </span>${escapeHtml(
    t("card.channel_ambiguous_repeaters", { n: candidates.length })
  )}</span><ul class="message-path-candidates">${candidateItems.join("")}</ul></li>`;
}

function renderPathSection(
  route: NormalizedPathRoute,
  contacts: readonly NormalizedPathContact[],
  t: LocalizeFunc,
  index: number
): string {
  const pathNumber = t("card.channel_path_number", { n: index + 1 });
  const descriptor = route.direct
    ? t("card.channel_direct")
    : `${countLabel(t, route.hopCount, "card.channel_hop_one", "card.channel_hops_count")} · ${countLabel(
      t,
      route.hashSizeBytes!,
      "card.channel_byte_one",
      "card.channel_bytes_count"
    )}`;
  const headingId = `channel-message-path-${index}`;
  const body = route.direct
    ? `<div class="message-path-direct">${escapeHtml(t("card.channel_direct"))}</div>`
    : `<ol class="message-path-hops">${route.pathSegments.map((token, hopIndex) =>
      renderHop(token, contacts, t, hopIndex)
    ).join("")}</ol>`;
  return `<section class="message-path" data-path-index="${index}" aria-labelledby="${headingId}">
    <h3 class="message-path-title" id="${headingId}">${escapeHtml(pathNumber)} · ${escapeHtml(descriptor)}</h3>
    ${body}
  </section>`;
}

function renderContent(
  params: ChannelPathsDialogParams,
  contacts: readonly NormalizedPathContact[]
): string {
  const routes = normalizedRoutes(params.routes);
  return `<p class="paths-warning" id="channel-paths-warning">${escapeHtml(
    params.localize("card.channel_paths_inference_warning")
  )}</p>${routes.map((route, index) =>
    renderPathSection(route, contacts, params.localize, index)
  ).join("")}`;
}

function deepestActiveElement(): HTMLElement | undefined {
  let active: Element | null = document.activeElement;
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active instanceof HTMLElement ? active : undefined;
}

export class MushroomMeshcoreChannelPathsDialog extends HTMLElement {
  public readonly dialogNext = true as const;

  private _params?: ChannelPathsDialogParams;
  private _contacts: NormalizedPathContact[] = [];
  private _adaptiveDialog?: AdaptiveDialogElement;
  private _fallbackDialog?: HTMLDialogElement;
  private _returnFocus?: HTMLElement;
  private _closed = false;
  private _generation = 0;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  public get params(): ChannelPathsDialogParams | undefined {
    return this._params;
  }

  public set params(value: ChannelPathsDialogParams | undefined) {
    this._generation += 1;
    this._params = value;
    this._closed = false;
    if (value && this.isConnected) this._render(value, this._generation);
  }

  // Compatibility with Home Assistant's legacy persistent-dialog lifecycle.
  public showDialog(params: ChannelPathsDialogParams): void {
    this.params = params;
  }

  public connectedCallback(): void {
    if (this._params) this._render(this._params, this._generation);
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

  private _render(params: ChannelPathsDialogParams, generation: number): void {
    this._returnFocus = params.returnFocus ?? deepestActiveElement();
    this._contacts = normalizeContacts(params.contacts);
    this._adaptiveDialog = undefined;
    this._fallbackDialog = undefined;
    this.shadowRoot!.innerHTML = `<style>${DIALOG_STYLES}</style>`;

    if (customElements.get("ha-adaptive-dialog")) {
      const dialog = document.createElement("ha-adaptive-dialog") as AdaptiveDialogElement;
      dialog.width = "small";
      dialog.headerTitle = params.title;
      dialog.innerHTML = `<div class="channel-paths-dialog-content" aria-describedby="channel-paths-warning">${renderContent(
        params,
        this._contacts
      )}</div>`;
      dialog.addEventListener("closed", () => this._finishClose(), { once: true });
      this.shadowRoot!.appendChild(dialog);
      this._adaptiveDialog = dialog;
      dialog.open = true;
      this._watchContacts(params, generation);
      return;
    }

    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "channel-paths-dialog-title");
    dialog.setAttribute("aria-describedby", "channel-paths-warning");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<div class="fallback-header">
      <div class="fallback-title" id="channel-paths-dialog-title">${escapeHtml(params.title)}</div>
      <button type="button" class="fallback-close" aria-label="${escapeHtml(params.closeLabel)}" title="${escapeHtml(params.closeLabel)}"><span aria-hidden="true">&times;</span></button>
    </div>
    <div class="channel-paths-dialog-content">${renderContent(params, this._contacts)}</div>`;
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
    Promise.resolve().then(() => {
      if (!this._closed && generation === this._generation) {
        dialog.querySelector<HTMLElement>(".fallback-close")?.focus();
      }
    });
    this._watchContacts(params, generation);
  }

  private _watchContacts(
    params: ChannelPathsDialogParams,
    generation: number
  ): void {
    if (!params.contactsPromise) return;
    void params.contactsPromise.then((contacts) => {
      if (this._closed || !this.isConnected || generation !== this._generation
        || params !== this._params) {
        return;
      }
      this._contacts = mergeContacts(this._contacts, normalizeContacts(contacts));
      const content = this.shadowRoot?.querySelector<HTMLElement>(
        ".channel-paths-dialog-content"
      );
      if (content) content.innerHTML = renderContent(params, this._contacts);
    }).catch(() => {
      // Route metadata remains useful when optional contact enrichment fails.
    });
  }

  private _finishClose(): void {
    if (this._closed) return;
    this._closed = true;
    this._generation += 1;
    let returnFocus = this._returnFocus;
    try {
      const currentReturnFocus = this._params?.resolveReturnFocus?.();
      if (currentReturnFocus?.isConnected) returnFocus = currentReturnFocus;
    } catch {
      // Fall back to the control captured when the dialog opened.
    }
    this.dispatchEvent(new CustomEvent("dialog-closed", {
      bubbles: true,
      composed: true,
      detail: { dialog: CHANNEL_PATHS_DIALOG_TAG },
    }));
    this.remove();
    if (returnFocus?.isConnected) {
      try {
        returnFocus.focus();
      } catch {
        // A removed or inert source control cannot receive focus.
      }
    }
  }
}

export function ensureChannelPathsDialog(): void {
  if (!customElements.get(CHANNEL_PATHS_DIALOG_TAG)) {
    customElements.define(
      CHANNEL_PATHS_DIALOG_TAG,
      MushroomMeshcoreChannelPathsDialog
    );
  }
}

/** A resolved loader matching Home Assistant's `show-dialog` contract. */
export function channelPathsDialogImport(): Promise<void> {
  ensureChannelPathsDialog();
  return Promise.resolve();
}

declare global {
  interface HTMLElementTagNameMap {
    "mushroom-meshcore-channel-paths-dialog": MushroomMeshcoreChannelPathsDialog;
  }
}
