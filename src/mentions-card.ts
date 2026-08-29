import { HeaderActionController } from "./actions.js";
import { escapeHtml } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import { STYLES } from "./styles.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";
import type {
  ActionConfig,
  HaAlertElement,
  HaFormElement,
  HaFormFieldSchema,
  HaFormSchema,
  HomeAssistant,
  MeshcoreMentionsCardConfig,
} from "./types.js";

const TODO_ENTITY_RE = /^todo\.[a-z0-9_]+$/;

const MENTIONS_STYLES = `
  ha-card.mentions-card {
    display: flex;
    min-height: 120px;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  ha-card.mentions-card.grid-rows { height: 100%; }

  .mentions-content {
    min-height: 0;
    padding: 0 var(--mush-spacing, 10px) var(--mush-spacing, 10px);
  }

  .grid-rows .mentions-content {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .mention-section + .mention-section { margin-top: var(--mush-spacing, 10px); }

  .mention-section-label {
    padding: 2px 2px 6px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .mention-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .mention-row {
    display: grid;
    grid-template-columns: var(--mushroom-meshcore-control-height) minmax(0, 1fr);
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--mushroom-meshcore-border-color);
  }

  .mention-row.completed { opacity: 0.62; }

  .mention-checkbox {
    position: relative;
    display: inline-flex;
    width: var(--mushroom-meshcore-control-height);
    height: var(--mushroom-meshcore-control-height);
    align-items: center;
    justify-content: center;
    align-self: center;
    border-radius: var(--mushroom-meshcore-control-radius);
    background: transparent;
    cursor: pointer;
  }

  .mention-checkbox:disabled { cursor: default; opacity: 0.5; }

  .mention-checkbox:focus-visible {
    outline: 2px solid var(--primary-color, var(--mushroom-meshcore-info-color));
    outline-offset: -2px;
  }

  .checkbox-shape {
    display: inline-flex;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--secondary-text-color, #727272);
    border-radius: var(--ha-checkbox-border-radius, var(--ha-border-radius-sm, 4px));
    color: var(--text-primary-color, white);
  }

  .mention-checkbox[aria-checked="true"] .checkbox-shape {
    border-color: var(--primary-color, var(--mushroom-meshcore-info-color));
    background: var(--primary-color, var(--mushroom-meshcore-info-color));
  }

  .checkbox-shape ha-icon { --mdc-icon-size: 16px; }

  .mention-copy {
    min-width: 0;
  }

  .mention-meta {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 6px;
  }

  .mention-sender {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
  }

  .mention-channel {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .mention-message,
  .mention-description,
  .mention-fallback {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .mention-message,
  .mention-fallback {
    margin-top: 2px;
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
  }

  .mention-description {
    margin-top: 4px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .mentions-state,
  .mentions-error {
    display: flex;
    min-height: 88px;
    align-items: center;
    justify-content: center;
    padding: 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    text-align: center;
  }

  .mentions-error {
    min-height: 0;
    margin-bottom: var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: color-mix(in srgb, var(--mushroom-meshcore-danger-color) 12%, transparent);
    color: var(--mushroom-meshcore-danger-color);
  }
`;

const EDITOR_STYLES = `
  .meshcore-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
`;

type TodoItemStatus = "needs_action" | "completed" | null;

interface TodoItem {
  uid: string;
  summary: string;
  status: TodoItemStatus;
  description?: string | null;
}

interface TodoItemsMessage {
  items: unknown[];
}

interface ParsedMention {
  sender: string;
  channel: string;
  message: string;
}

function parseMention(summary: string): ParsedMention | null {
  const separator = summary.indexOf(": ");
  if (separator < 1) return null;
  const prefix = summary.slice(0, separator);
  const onIndex = prefix.lastIndexOf(" on ");
  if (onIndex < 1) return null;
  const sender = prefix.slice(0, onIndex).trim();
  const channel = prefix.slice(onIndex + 4).trim();
  if (!sender || !channel) return null;
  return {
    sender,
    channel,
    message: summary.slice(separator + 2),
  };
}

function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["uid"] === "string" &&
    typeof item["summary"] === "string" &&
    (item["status"] === "needs_action" ||
      item["status"] === "completed" ||
      item["status"] === null) &&
    (item["description"] === undefined ||
      item["description"] === null ||
      typeof item["description"] === "string")
  );
}

export class MeshcoreMentionsCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreMentionsCardConfig;
  private _items?: TodoItem[];
  private _loading = true;
  private _subscriptionError = false;
  private _actionError = false;
  private _connected = false;
  private _subscribed = false;
  private _subscriptionId = 0;
  private _unsubscribe?: () => void;
  private _connection?: HomeAssistant["connection"];
  private _readyListenerAttached = false;
  private _stateFingerprint = "";
  private readonly _pendingIds = new Set<string>();
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
    this.shadowRoot!.addEventListener("click", (event) => {
      if (this._headerActions.handleClick(event)) return;
      const control = (event.target as Element).closest?.(
        "[data-mention-uid]"
      ) as HTMLElement | null;
      const uid = control?.dataset["mentionUid"];
      if (uid) void this._toggleMention(uid);
    });
    this.shadowRoot!.addEventListener("pointerdown", (event) => {
      this._headerActions.handlePointerDown(event);
    });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
      this.shadowRoot!.addEventListener(eventName, () => {
        this._headerActions.handlePointerEnd();
      });
    }
  }

  connectedCallback(): void {
    this._connected = true;
    if (this._subscriptionError) {
      this._subscriptionError = false;
      if (!this._items) this._loading = true;
    }
    this._attachReadyListener();
    this._ensureSubscription();
  }

  disconnectedCallback(): void {
    this._connected = false;
    this._detachReadyListener();
    this._stopSubscription();
    this._headerActions.disconnect();
  }

  setConfig(config: MeshcoreMentionsCardConfig): void {
    const previousEntity = this._config?.entity;
    this._config = { ...config };
    if (previousEntity !== this._config.entity) {
      this._items = undefined;
      this._loading = true;
      this._subscriptionError = false;
      this._actionError = false;
      this._pendingIds.clear();
      this._restartSubscription();
    }
    this._stateFingerprint = "";
    this._render();
  }

  set hass(hass: HomeAssistant) {
    const oldConnection = this._connection;
    this._hass = hass;
    this._connection = hass.connection;
    if (oldConnection !== this._connection) {
      if (oldConnection) this._detachReadyListener(oldConnection);
      this._readyListenerAttached = false;
      this._attachReadyListener();
      if (this._subscribed) this._restartSubscription();
    }

    if (!this._hasAvailableTarget() && this._subscribed) {
      this._stopSubscription();
    } else if (this._hasAvailableTarget()) {
      this._ensureSubscription();
    }

    const entityId = this._config?.entity;
    const state = entityId ? hass.states[entityId] : undefined;
    const fingerprint = state
      ? `${entityId}|${state.state}|${String(
          state.attributes["friendly_name"] ?? ""
        )}|${String(state.attributes["supported_features"] ?? "")}`
      : `${entityId ?? ""}|missing`;
    if (fingerprint !== this._stateFingerprint) {
      this._stateFingerprint = fingerprint;
      this._render();
    }
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _selectedState() {
    const entityId = this._config?.entity;
    return entityId ? this._hass?.states[entityId] : undefined;
  }

  private _hasAvailableTarget(): boolean {
    const entityId = this._config?.entity;
    const state = this._selectedState();
    return (
      typeof entityId === "string" &&
      TODO_ENTITY_RE.test(entityId) &&
      !!state &&
      state.state !== "unknown" &&
      state.state !== "unavailable"
    );
  }

  private _canUpdateItems(): boolean {
    const features = Number(
      this._selectedState()?.attributes["supported_features"] ?? 0
    );
    return Number.isFinite(features) && (features & 4) !== 0;
  }

  private _attachReadyListener(): void {
    const connection = this._hass?.connection;
    if (!this._connected || !connection || this._readyListenerAttached) return;
    connection.addEventListener?.("ready", this._handleConnectionReady);
    this._readyListenerAttached = true;
    this._connection = connection;
  }

  private _detachReadyListener(
    connection: HomeAssistant["connection"] | undefined = this._connection
  ): void {
    if (!this._readyListenerAttached) return;
    connection?.removeEventListener?.("ready", this._handleConnectionReady);
    this._readyListenerAttached = false;
  }

  private _handleConnectionReady = (): void => {
    if (!this._connected || !this._hasAvailableTarget()) return;
    this._subscriptionId++;
    this._subscribed = false;
    this._unsubscribe = undefined;
    this._subscriptionError = false;
    if (!this._items) this._loading = true;
    this._ensureSubscription();
  };

  private _ensureSubscription(): void {
    if (
      !this._connected ||
      this._subscribed ||
      this._subscriptionError ||
      !this._hasAvailableTarget() ||
      !this._hass?.connection
    ) {
      return;
    }
    this._subscribe();
  }

  private _restartSubscription(): void {
    this._stopSubscription();
    this._ensureSubscription();
  }

  private _stopSubscription(): void {
    this._subscriptionId++;
    this._subscribed = false;
    const unsubscribe = this._unsubscribe;
    this._unsubscribe = undefined;
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // A disconnected socket can leave a stale unsubscribe function.
      }
    }
  }

  private _subscribe(): void {
    const hass = this._hass;
    const entityId = this._config?.entity;
    if (!hass?.connection || !entityId) return;
    const subscriptionId = ++this._subscriptionId;
    this._subscribed = true;
    this._subscriptionError = false;
    let promise: Promise<() => void>;
    try {
      promise = hass.connection.subscribeMessage<TodoItemsMessage>(
        (message) => {
          if (subscriptionId !== this._subscriptionId) return;
          this._processItems(message);
        },
        { type: "todo/item/subscribe", entity_id: entityId },
        { resubscribe: false }
      );
    } catch {
      this._handleSubscriptionError(subscriptionId);
      return;
    }
    void promise
      .then((unsubscribe) => {
        if (subscriptionId !== this._subscriptionId || !this._connected) {
          try {
            unsubscribe();
          } catch {
            // The connection may have dropped before registration completed.
          }
          return;
        }
        this._unsubscribe = unsubscribe;
      })
      .catch(() => this._handleSubscriptionError(subscriptionId));
  }

  private _handleSubscriptionError(subscriptionId: number): void {
    if (subscriptionId !== this._subscriptionId) return;
    this._subscribed = false;
    this._unsubscribe = undefined;
    this._loading = false;
    this._subscriptionError = true;
    this._render();
  }

  private _processItems(message: TodoItemsMessage): void {
    if (!Array.isArray(message.items)) return;
    this._items = message.items.filter(isTodoItem).map((item) => ({ ...item }));
    this._pendingIds.clear();
    this._loading = false;
    this._subscriptionError = false;
    this._actionError = false;
    this._render();
  }

  private async _toggleMention(uid: string): Promise<void> {
    if (this._pendingIds.has(uid)) return;
    const item = this._items?.find((candidate) => candidate.uid === uid);
    const entityId = this._config?.entity;
    if (
      !item ||
      !entityId ||
      !this._hass?.callService ||
      !this._canUpdateItems()
    ) {
      return;
    }
    const nextStatus = item.status === "completed" ? "needs_action" : "completed";
    this._pendingIds.add(uid);
    this._actionError = false;
    this._render();
    try {
      await Promise.resolve(
        this._hass.callService(
          "todo",
          "update_item",
          { item: uid, status: nextStatus },
          { entity_id: entityId }
        )
      );
      item.status = nextStatus;
    } catch {
      this._actionError = true;
    } finally {
      this._pendingIds.delete(uid);
      this._render();
    }
  }

  private _renderItem(item: TodoItem, completed: boolean): string {
    const t = this._localize();
    const parsed = parseMention(item.summary);
    const label = completed
      ? t("card.mentions_reopen_label", { item: item.summary })
      : t("card.mentions_handle_label", { item: item.summary });
    const pending = this._pendingIds.has(item.uid);
    const disabled = pending || !this._canUpdateItems();
    const checkbox = `<button type="button" class="mention-checkbox" data-mention-uid="${escapeHtml(
      item.uid
    )}" role="checkbox" aria-checked="${completed ? "true" : "false"}" aria-label="${escapeHtml(
      label
    )}"${disabled ? " disabled" : ""}${pending ? ' aria-busy="true"' : ""}>
      <span class="checkbox-shape" aria-hidden="true">${
        completed ? '<ha-icon icon="mdi:check"></ha-icon>' : ""
      }</span>
    </button>`;
    const summary = parsed
      ? `<div class="mention-meta"><strong class="mention-sender">${escapeHtml(
          parsed.sender
        )}</strong><span class="mention-channel">${escapeHtml(
          t("card.mentions_channel", { channel: parsed.channel })
        )}</span></div><div class="mention-message">${escapeHtml(parsed.message)}</div>`
      : `<div class="mention-fallback">${escapeHtml(item.summary)}</div>`;
    const description = item.description?.trim()
      ? `<div class="mention-description">${escapeHtml(item.description)}</div>`
      : "";
    return `<article class="mention-row${completed ? " completed" : ""}" data-mention-row="${escapeHtml(
      item.uid
    )}">${checkbox}<div class="mention-copy">${summary}${description}</div></article>`;
  }

  private _renderSection(label: string, items: TodoItem[], completed: boolean): string {
    if (!items.length) return "";
    return `<section class="mention-section" aria-label="${escapeHtml(label)}">
      <div class="mention-section-label">${escapeHtml(label)}</div>
      <div class="mention-list">${items
        .map((item) => this._renderItem(item, completed))
        .join("")}</div>
    </section>`;
  }

  private _renderItems(): string {
    const t = this._localize();
    if (this._subscriptionError) {
      return `<div class="mentions-state">${escapeHtml(
        t("card.mentions_unavailable")
      )}</div>`;
    }
    if (this._loading || !this._items) {
      return `<div class="mentions-state">${escapeHtml(
        t("card.mentions_loading")
      )}</div>`;
    }
    const pending = this._items.filter((item) => item.status !== "completed");
    const completed = this._items.filter((item) => item.status === "completed");
    if (!pending.length && (this._config?.hide_completed !== false || !completed.length)) {
      return `<div class="mentions-state">${escapeHtml(
        t("card.mentions_empty")
      )}</div>`;
    }
    if (this._config?.hide_completed !== false) {
      return `<div class="mention-list">${pending
        .map((item) => this._renderItem(item, false))
        .join("")}</div>`;
    }
    return `${this._renderSection(
      t("card.mentions_pending"),
      pending,
      false
    )}${this._renderSection(t("card.mentions_handled"), completed, true)}`;
  }

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = this._localize();
    const entityId = this._config.entity;
    if (!entityId) {
      this._setBody(
        `<div class="mentions-state">${escapeHtml(
          t("card.select_mentions_prompt")
        )}</div>`,
        false
      );
      return;
    }
    if (!TODO_ENTITY_RE.test(entityId)) {
      this._setBody(
        `<div class="mentions-state">${escapeHtml(
          t("card.mentions_invalid_entity", { id: entityId })
        )}</div>`,
        false
      );
      return;
    }
    const state = this._selectedState();
    if (!state) {
      this._setBody(
        `<div class="mentions-state">${escapeHtml(
          t("card.mentions_not_found", { id: entityId })
        )}</div>`,
        false
      );
      return;
    }

    const unavailable = state.state === "unknown" || state.state === "unavailable";
    const dataUnavailable = unavailable || this._subscriptionError;
    const pendingCount = this._items?.filter(
      (item) => item.status !== "completed"
    ).length;
    const secondary = dataUnavailable
      ? t("card.unavailable")
      : pendingCount === undefined
        ? t("card.mentions_loading_short")
        : pendingCount === 1
          ? t("card.mentions_count_one")
          : t("card.mentions_count", { n: pendingCount });
    const active = !dataUnavailable && (pendingCount ?? 0) > 0;
    const header = renderTileHeader(this._config, {
      displayName: t("card.mentions_title"),
      secondary,
      icon: "mdi:at",
      active,
      primaryEntityId: entityId,
      inactiveBadgeIcon: dataUnavailable
        ? "mdi:alert-circle-outline"
        : pendingCount === undefined
          ? "mdi:clock-outline"
          : "mdi:check",
    });
    const actionError = this._actionError
      ? `<div class="mentions-error" role="alert">${escapeHtml(
          t("card.mentions_update_failed")
        )}</div>`
      : "";
    const content = unavailable
      ? `<div class="mentions-state">${escapeHtml(
          t("card.mentions_entity_unavailable")
        )}</div>`
      : `${actionError}${this._renderItems()}`;
    this._setBody(`${header}<div class="mentions-content">${content}</div>`, true);
  }

  private _setBody(body: string, hydrateHeader: boolean): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const className = constrained ? "mentions-card grid-rows" : "mentions-card";
    this.shadowRoot!.innerHTML = `<style>${STYLES}${MENTIONS_STYLES}</style><ha-card class="${className}">${body}</ha-card>`;
    if (hydrateHeader) hydrateTileInfo(this.shadowRoot!);
  }

  getCardSize(): number {
    return 4;
  }

  getGridOptions(): {
    columns: "full";
    rows: "auto";
    min_columns: number;
    min_rows: number;
  } {
    return { columns: "full", rows: "auto", min_columns: 6, min_rows: 1 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-mentions-card-editor");
  }

  static getStubConfig(): MeshcoreMentionsCardConfig {
    return {};
  }
}

const STRING_SETTING_KEYS = ["name", "icon", "icon_color"] as const;
const ACTION_SETTING_KEYS = [
  "tap_action",
  "hold_action",
  "double_tap_action",
] as const;

export class MeshcoreMentionsCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreMentionsCardConfig;
  private _discoveryFingerprint = "";

  setConfig(config: MeshcoreMentionsCardConfig): void {
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
    const fingerprint = this._todoEntities().join("|");
    if (fingerprint !== this._discoveryFingerprint) {
      this._discoveryFingerprint = fingerprint;
      this._renderEditor();
    }
  }

  connectedCallback(): void {
    this._renderEditor();
  }

  private _todoEntities(): string[] {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((entityId) => TODO_ENTITY_RE.test(entityId))
      .sort();
  }

  private _dispatchConfig(config: MeshcoreMentionsCardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config } }));
  }

  private _targetForm(entityIds: string[]): HaFormElement {
    const t = this._localize();
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      {
        name: "entity",
        label: t("editor.target_mentions"),
        selector: {
          entity: { domain: "todo", include_entities: entityIds },
        },
      },
    ];
    form.data = { entity: this._config?.entity ?? null };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config: MeshcoreMentionsCardConfig = { ...this._config };
      const entityId = value["entity"];
      if (typeof entityId === "string" && entityId) config.entity = entityId;
      else delete config.entity;
      this._dispatchConfig(config);
      this._renderEditor();
    });
    return form;
  }

  private _localize(): LocalizeFunc {
    return makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
  }

  private _settingsSchema(): HaFormSchema[] {
    const t = this._localize();
    const appearance: HaFormFieldSchema[] = [
      { name: "name", label: t("editor.name_label"), selector: { text: {} } },
      { name: "icon", label: t("editor.icon_label"), selector: { icon: {} } },
      {
        name: "icon_color",
        label: t("editor.icon_color_label"),
        selector: { ui_color: {} },
      },
    ];
    const interactions: HaFormFieldSchema[] = [
      {
        name: "tap_action",
        label: t("editor.tap_action"),
        selector: { ui_action: { default_action: "more-info" } },
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
        name: "hide_completed",
        label: t("editor.hide_completed_mentions"),
        selector: { boolean: {} },
      },
    ];
    const section = (
      title: string,
      icon: string,
      schema: HaFormFieldSchema[]
    ): HaFormSchema => ({
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
      section(t("editor.section_mentions_behavior"), "mdi:format-list-checks", behavior),
    ];
  }

  private _settingsForm(): HaFormElement {
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = this._settingsSchema();
    form.data = {
      name: this._config?.name ?? "",
      icon: this._config?.icon ?? null,
      icon_color: this._config?.icon_color ?? null,
      tap_action: this._config?.tap_action,
      hold_action: this._config?.hold_action,
      double_tap_action: this._config?.double_tap_action,
      hide_completed: this._config?.hide_completed !== false,
    };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config: MeshcoreMentionsCardConfig = { ...this._config };
      for (const key of STRING_SETTING_KEYS) {
        const raw = value[key];
        if (typeof raw === "string" && raw.trim()) config[key] = raw;
        else delete config[key];
      }
      for (const key of ACTION_SETTING_KEYS) {
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
      if (value["hide_completed"] === false) config.hide_completed = false;
      else delete config.hide_completed;
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
    const entityIds = this._todoEntities();
    if (!entityIds.length) {
      const alert = document.createElement("ha-alert") as HaAlertElement;
      alert.alertType = "info";
      alert.textContent = this._localize()("editor.no_todo_entities");
      container.appendChild(alert);
    } else {
      container.appendChild(this._targetForm(entityIds));
      if (this._config.entity) container.appendChild(this._settingsForm());
    }
    this.appendChild(container);
  }
}
