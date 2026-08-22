import type {
  ActionConfig,
  HaAlertElement,
  HaFormElement,
  HaFormFieldSchema,
  HaFormSchema,
  HomeAssistant,
  MeshcoreChannelCardConfig,
} from "./types.js";
import { HeaderActionController } from "./actions.js";
import { escapeHtml } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import { STYLES } from "./styles.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";

const CHANNEL_ENTITY_RE = /^binary_sensor\.meshcore_.*_ch_\d+_messages$/;
const DEFAULT_HOURS_TO_SHOW = 24;
const DEFAULT_MAX_MESSAGES = 200;
const LIVE_END_DAYS = 365;
const STREAM_RENDER_DELAY = 250;

const CHANNEL_STYLES = `
  :host { display: block; height: 100%; }

  ha-card.channel-chat-card {
    display: flex;
    min-height: 0;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  ha-card.channel-chat-card.grid-rows { height: 100%; }

  .channel-history {
    box-sizing: border-box;
    height: 385px;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--mush-spacing, 10px) var(--mush-spacing, 10px);
    scrollbar-gutter: stable;
  }

  .grid-rows .channel-history {
    height: auto;
    flex: 1;
  }

  .channel-history:focus-visible {
    outline: 2px solid var(--primary-color, var(--mushroom-meshcore-info-color));
    outline-offset: -2px;
  }

  .date-header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 0 5px;
    background: var(--mushroom-meshcore-card-background);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .message-row {
    padding: 8px 0;
    border-bottom: 1px solid var(--mushroom-meshcore-border-color);
  }

  .message-meta {
    display: flex;
    min-width: 0;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--mush-spacing, 10px);
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-primary-font-size);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
  }

  .message-sender {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 700;
  }

  .message-time {
    flex: 0 0 auto;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .message-body {
    overflow-wrap: anywhere;
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    white-space: pre-wrap;
  }

  .message-meta + .message-body { margin-top: 2px; }

  .history-state {
    display: flex;
    min-height: 120px;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    text-align: center;
  }

  .history-state ha-spinner { color: var(--primary-color); }
`;

const EDITOR_STYLES = `
  .meshcore-editor { display: flex; flex-direction: column; gap: 8px; }
  ha-alert { display: block; margin: 8px 0; }
`;

interface LogbookEntry {
  when: number;
  name: string;
  message?: string;
  entity_id?: string;
  context_id?: string;
}

interface LogbookStreamMessage {
  events: LogbookEntry[];
  start_time?: number;
  end_time?: number;
  partial?: boolean;
}

interface ParsedChannel {
  channelName: string;
}

interface ParsedMessage {
  sender: string | null;
  body: string;
}

interface ScrollAnchor {
  top: number;
  height: number;
  atTop: boolean;
}

function normalizedPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : fallback;
}

function parseChannel(
  entityId: string,
  attrs: Record<string, unknown>,
  discoveredHubName?: string
): ParsedChannel {
  const configuredIndex =
    typeof attrs["channel_index"] === "number" ? attrs["channel_index"] : 0;
  const entityMatch = entityId.match(
    /^binary_sensor\.meshcore_(.+)_ch_(\d+)_messages$/
  );
  const hubFromId =
    discoveredHubName ||
    (entityMatch ? entityMatch[1]!.replace(/_/g, " ") : entityId);
  const channelIndex = entityMatch
    ? Number.parseInt(entityMatch[2]!, 10)
    : configuredIndex;
  const friendlyName = String(attrs["friendly_name"] ?? "");
  const full = friendlyName.match(
    /^MeshCore\s+(.+?)\s+\([0-9a-f]+\)\s+(.+?)\s+Messages\b/i
  );
  if (full) {
    return {
      channelName: full[2]!,
    };
  }
  const short = friendlyName.match(/^(.+?)\s+Messages\b/i);
  let channelName = (short?.[1] ?? friendlyName).trim();
  const hubName = discoveredHubName?.trim() || hubFromId;
  if (hubName && channelName.startsWith(`${hubName} `)) {
    channelName = channelName.slice(hubName.length).trim();
  }
  return {
    channelName: channelName || `Ch ${channelIndex}`,
  };
}

/** Remove one MeshCore channel prefix and split only the first sender colon. */
function parseMessage(message: string): ParsedMessage | null {
  if (!message.trim()) return null;
  const withoutChannel = message.replace(/^\s*<[^>\r\n]+>\s*/, "");
  if (!withoutChannel.trim()) return null;
  const separator = withoutChannel.indexOf(":");
  if (separator <= 0) return { sender: null, body: withoutChannel };
  const sender = withoutChannel.slice(0, separator).trim();
  if (!sender) return { sender: null, body: withoutChannel };
  let body = withoutChannel.slice(separator + 1);
  if (body.startsWith(" ")) body = body.slice(1);
  return { sender, body };
}

export class MeshcoreChannelCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreChannelCardConfig;
  private _entries = new Map<string, LogbookEntry>();
  private _messages: LogbookEntry[] = [];
  private _loading = true;
  private _historyError = false;
  private _connected = false;
  private _subscribed = false;
  private _subscriptionId = 0;
  private _unsubscribe?: () => void;
  private _connection?: HomeAssistant["connection"];
  private _readyListenerAttached = false;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private _stateFingerprint = "";
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
      this._headerActions.handleClick(event);
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
    if (this._historyError) {
      this._historyError = false;
      if (!this._messages.length) this._loading = true;
    }
    this._attachReadyListener();
    if (this._maintenanceTimer === null) {
      this._maintenanceTimer = setInterval(() => {
        if (this._purgeAndLimit() || this._messages.length) this._render();
      }, 60_000);
    }
    this._ensureSubscription();
  }

  disconnectedCallback(): void {
    this._connected = false;
    this._detachReadyListener();
    this._stopSubscription();
    this._headerActions.disconnect();
    if (this._renderTimer !== null) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    if (this._maintenanceTimer !== null) {
      clearInterval(this._maintenanceTimer);
      this._maintenanceTimer = null;
    }
  }

  setConfig(config: MeshcoreChannelCardConfig): void {
    const previousEntity = this._config?.entity;
    const previousHours = this._hoursToShow();
    const previousMax = this._maxMessages();
    this._config = { ...config };
    const historyChanged =
      previousEntity !== this._config.entity ||
      previousHours !== this._hoursToShow() ||
      previousMax !== this._maxMessages();
    if (historyChanged) {
      this._entries.clear();
      this._messages = [];
      this._loading = true;
      this._historyError = false;
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

    const entityId = this._config?.entity;
    const state = entityId ? hass.states[entityId] : undefined;
    const valid = !!entityId && CHANNEL_ENTITY_RE.test(entityId) && !!state;
    if (!valid && this._subscribed) this._stopSubscription();
    else if (valid) this._ensureSubscription();

    const fingerprint = state
      ? `${entityId}|${state.state}|${String(state.attributes["friendly_name"] ?? "")}`
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

  private _hoursToShow(): number {
    return normalizedPositiveNumber(
      this._config?.hours_to_show,
      DEFAULT_HOURS_TO_SHOW
    );
  }

  private _maxMessages(): number {
    return Math.floor(
      normalizedPositiveNumber(
        this._config?.max_messages,
        DEFAULT_MAX_MESSAGES
      )
    );
  }

  private _selectedState() {
    const entityId = this._config?.entity;
    return entityId ? this._hass?.states[entityId] : undefined;
  }

  private _hasValidTarget(): boolean {
    const entityId = this._config?.entity;
    return (
      typeof entityId === "string" &&
      CHANNEL_ENTITY_RE.test(entityId) &&
      !!this._selectedState()
    );
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
    if (!this._connected || !this._hasValidTarget()) return;
    // Keep the existing entries as a scroll-stable cache. Replayed history is
    // merged through the same dedupe map, so reconnects cannot duplicate rows.
    // The old subscription died with the socket and must not be unsubscribed on
    // the new connection; Home Assistant's native Logbook follows this pattern.
    this._subscriptionId++;
    this._subscribed = false;
    this._unsubscribe = undefined;
    this._historyError = false;
    if (!this._messages.length) this._loading = true;
    this._ensureSubscription();
  };

  private _ensureSubscription(): void {
    if (
      !this._connected ||
      this._subscribed ||
      this._historyError ||
      !this._hasValidTarget() ||
      !this._hass?.connection
    ) {
      return;
    }
    this._subscribe();
  }

  private _restartSubscription(clearLoading = true): void {
    this._stopSubscription();
    if (clearLoading && !this._messages.length) this._loading = true;
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
    this._historyError = false;
    const now = Date.now();
    const start = new Date(now - this._hoursToShow() * 60 * 60 * 1000);
    const end = new Date(now + LIVE_END_DAYS * 24 * 60 * 60 * 1000);
    let promise: Promise<() => void>;
    try {
      promise = hass.connection.subscribeMessage<LogbookStreamMessage>(
        (streamMessage) => {
          if (subscriptionId !== this._subscriptionId) return;
          this._processStreamMessage(streamMessage);
        },
        {
          type: "logbook/event_stream",
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          entity_ids: [entityId],
        },
        { resubscribe: false }
      );
    } catch {
      this._subscribed = false;
      this._loading = false;
      this._historyError = true;
      this._render();
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
      .catch(() => {
        if (subscriptionId !== this._subscriptionId) return;
        this._subscribed = false;
        this._unsubscribe = undefined;
        this._loading = false;
        this._historyError = true;
        this._render();
      });
  }

  private _processStreamMessage(streamMessage: LogbookStreamMessage): void {
    if (!Array.isArray(streamMessage.events)) return;
    const entityId = this._config?.entity;
    for (const entry of streamMessage.events) {
      if (
        !Number.isFinite(entry.when) ||
        entry.when <= 0 ||
        (entry.entity_id && entry.entity_id !== entityId) ||
        typeof entry.message !== "string" ||
        !parseMessage(entry.message)
      ) {
        continue;
      }
      this._entries.set(this._entryKey(entry), entry);
    }
    this._loading = false;
    this._historyError = false;
    this._purgeAndLimit();
    this._scheduleRender();
  }

  private _entryKey(entry: LogbookEntry): string {
    return [
      entry.entity_id ?? "",
      String(entry.when),
      entry.context_id ?? "",
      entry.message ?? "",
    ].join("\u0000");
  }

  private _purgeAndLimit(): boolean {
    const oldKeys = this._messages.map((entry) => this._entryKey(entry)).join("\u0001");
    const cutoff = Date.now() / 1000 - this._hoursToShow() * 60 * 60;
    const entries = Array.from(this._entries.values())
      .filter((entry) => entry.when >= cutoff)
      .sort((a, b) => b.when - a.when)
      .slice(0, this._maxMessages());
    const retainedKeys = new Set(entries.map((entry) => this._entryKey(entry)));
    for (const [key] of this._entries) {
      if (!retainedKeys.has(key)) this._entries.delete(key);
    }
    this._messages = entries;
    return oldKeys !== entries.map((entry) => this._entryKey(entry)).join("\u0001");
  }

  private _scheduleRender(): void {
    if (this._renderTimer !== null) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this._render();
    }, STREAM_RENDER_DELAY);
  }

  private _formatOptions(): {
    locale: string;
    timeZone?: string;
    hour12?: boolean;
  } {
    const locale =
      this._hass?.language ?? this._hass?.locale?.language ?? navigator.language;
    const zoneMode = this._hass?.locale?.time_zone;
    const timeZone =
      zoneMode === "server" ? this._hass?.config?.time_zone : undefined;
    const timeFormat = this._hass?.locale?.time_format;
    const hour12 =
      timeFormat === "12" ? true : timeFormat === "24" ? false : undefined;
    return { locale, timeZone, hour12 };
  }

  private _formatter(
    options: Intl.DateTimeFormatOptions
  ): Intl.DateTimeFormat {
    const format = this._formatOptions();
    try {
      return new Intl.DateTimeFormat(format.locale, {
        ...options,
        timeZone: format.timeZone,
      });
    } catch {
      return new Intl.DateTimeFormat(undefined, options);
    }
  }

  private _dateKey(date: Date): string {
    const parts = this._formatter({
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      calendar: "gregory",
      numberingSystem: "latn",
    } as Intl.DateTimeFormatOptions).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  private _previousDateKey(date: Date): string {
    const [year, month, day] = this._dateKey(date).split("-").map(Number);
    const previous = new Date(Date.UTC(year!, month! - 1, day! - 1));
    return previous.toISOString().slice(0, 10);
  }

  private _dateLabel(date: Date): string {
    const t = this._localize();
    const key = this._dateKey(date);
    const today = this._dateKey(new Date());
    const yesterday = this._previousDateKey(new Date());
    const dateText = this._formatter({
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
    if (key === today) return `${t("card.today")} · ${dateText}`;
    if (key === yesterday) return `${t("card.yesterday")} · ${dateText}`;
    return dateText;
  }

  private _timeLabel(date: Date): string {
    const { hour12 } = this._formatOptions();
    return this._formatter({
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12,
    }).format(date);
  }

  private _renderMessages(): string {
    if (this._loading) {
      return `<div class="history-state"><div><ha-spinner></ha-spinner><div>${escapeHtml(
        this._localize()("card.channel_history_loading")
      )}</div></div></div>`;
    }
    if (this._historyError) {
      return `<div class="history-state">${escapeHtml(
        this._localize()("card.channel_history_unavailable")
      )}</div>`;
    }
    if (!this._messages.length) {
      return `<div class="history-state">${escapeHtml(
        this._localize()("card.channel_history_empty", {
          hours: this._hoursToShow(),
        })
      )}</div>`;
    }

    const groups = new Map<string, { date: Date; entries: LogbookEntry[] }>();
    for (const entry of this._messages) {
      const date = new Date(entry.when * 1000);
      const key = this._dateKey(date);
      const group = groups.get(key);
      if (group) group.entries.push(entry);
      else groups.set(key, { date, entries: [entry] });
    }
    return Array.from(groups.values())
      .map((group) => {
        const dateHeader = this._config?.hide_date_headers
          ? ""
          : `<div class="date-header">${escapeHtml(
              this._dateLabel(group.date)
            )}</div>`;
        const rows = group.entries.map((entry) => this._renderMessage(entry)).join("");
        return `<section class="date-group">${dateHeader}${rows}</section>`;
      })
      .join("");
  }

  private _renderMessage(entry: LogbookEntry): string {
    const parsed = parseMessage(entry.message ?? "");
    if (!parsed) return "";
    const date = new Date(entry.when * 1000);
    const time = this._config?.hide_timestamps
      ? ""
      : `<time class="message-time" datetime="${escapeHtml(
          date.toISOString()
        )}">${escapeHtml(this._timeLabel(date))}</time>`;
    const sender = parsed.sender
      ? `<strong class="message-sender">${escapeHtml(parsed.sender)}</strong>`
      : "";
    const meta = sender || time
      ? `<div class="message-meta">${sender}${time}</div>`
      : "";
    const body = parsed.body
      ? `<div class="message-body">${escapeHtml(parsed.body)}</div>`
      : "";
    return `<article class="message-row">${meta}${body}</article>`;
  }

  private _captureScrollAnchor(): ScrollAnchor | null {
    const history = this.shadowRoot?.querySelector<HTMLElement>(".channel-history");
    if (!history) return null;
    return {
      top: history.scrollTop,
      height: history.scrollHeight,
      atTop: history.scrollTop <= 4,
    };
  }

  private _restoreScrollAnchor(anchor: ScrollAnchor | null): void {
    if (!anchor) return;
    requestAnimationFrame(() => {
      const history = this.shadowRoot?.querySelector<HTMLElement>(".channel-history");
      if (!history) return;
      history.scrollTop = anchor.atTop
        ? 0
        : anchor.top + (history.scrollHeight - anchor.height);
    });
  }

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = this._localize();
    const entityId = this._config.entity;
    if (!entityId) {
      this._setBody(
        `<div class="empty">${escapeHtml(
          t("card.select_channel_prompt")
        )}</div>`,
        false
      );
      return;
    }
    if (!CHANNEL_ENTITY_RE.test(entityId) || !this._selectedState()) {
      this._setBody(
        `<div class="empty">${escapeHtml(
          t("card.channel_not_found", { id: entityId })
        )}</div>`,
        false
      );
      return;
    }

    const state = this._selectedState()!;
    const registryEntry = this._hass.entities[entityId];
    const device = registryEntry?.device_id
      ? this._hass.devices[registryEntry.device_id]
      : undefined;
    const discoveredHubName = device?.name_by_user || device?.name || undefined;
    const parsed = parseChannel(
      entityId,
      state.attributes as Record<string, unknown>,
      discoveredHubName
    );
    const stateValue = state.state.toLowerCase();
    const active = stateValue === "active" || stateValue === "on";
    const unavailable = stateValue === "unknown" || stateValue === "unavailable";
    const statusKey = active
      ? "card.active"
      : unavailable
        ? "card.unavailable"
        : "card.inactive";
    const secondary = t(statusKey);
    const header = renderTileHeader(this._config, {
      displayName: parsed.channelName,
      secondary,
      icon: "mdi:message-bulleted",
      active,
      primaryEntityId: entityId,
      inactiveBadgeIcon: "mdi:message-off",
    });
    const label = t("card.channel_chat_label", {
      channel: this._config.name || parsed.channelName,
    });
    const history = `<div class="channel-history" role="log" tabindex="0" aria-label="${escapeHtml(
      label
    )}">${this._renderMessages()}</div>`;
    this._setBody(`${header}${history}`, true);
  }

  private _setBody(body: string, hydrateHeader: boolean): void {
    const anchor = this._captureScrollAnchor();
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const className = constrained
      ? "channel-chat-card grid-rows"
      : "channel-chat-card";
    this.shadowRoot!.innerHTML = `<style>${STYLES}${CHANNEL_STYLES}</style><ha-card class="${className}">${body}</ha-card>`;
    if (hydrateHeader) hydrateTileInfo(this.shadowRoot!);
    this._restoreScrollAnchor(anchor);
  }

  getCardSize(): number {
    return 8;
  }

  getGridOptions(): {
    columns: "full";
    rows: number;
    min_columns: number;
    min_rows: number;
  } {
    return {
      columns: "full",
      rows: 8,
      min_columns: 6,
      min_rows: 4,
    };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-channel-card-editor");
  }

  static getStubConfig(): MeshcoreChannelCardConfig {
    return {};
  }
}

const STRING_SETTING_KEYS = ["name", "icon", "icon_color"] as const;
const BOOLEAN_SETTING_KEYS = ["hide_timestamps", "hide_date_headers"] as const;
const ACTION_SETTING_KEYS = [
  "tap_action",
  "hold_action",
  "double_tap_action",
] as const;

export class MeshcoreChannelCardEditor extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreChannelCardConfig;
  private _discoveryFingerprint = "";

  setConfig(config: MeshcoreChannelCardConfig): void {
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
    const fingerprint = this._channelEntities().join("|");
    if (fingerprint !== this._discoveryFingerprint) {
      this._discoveryFingerprint = fingerprint;
      this._renderEditor();
    }
  }

  connectedCallback(): void {
    this._renderEditor();
  }

  private _channelEntities(): string[] {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((entityId) => CHANNEL_ENTITY_RE.test(entityId))
      .sort();
  }

  private _dispatchConfig(config: MeshcoreChannelCardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config } }));
  }

  private _targetForm(entityIds: string[]): HaFormElement {
    const t = makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    form.computeLabel = (schema) =>
      ("label" in schema ? schema.label : undefined) ?? schema.name;
    form.schema = [
      {
        name: "entity",
        label: t("editor.target_channel"),
        selector: {
          entity: {
            domain: "binary_sensor",
            include_entities: entityIds,
          },
        },
      },
    ];
    form.data = { entity: this._config?.entity ?? null };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config: MeshcoreChannelCardConfig = { ...this._config };
      const entityId = value["entity"];
      if (typeof entityId === "string" && entityId) config.entity = entityId;
      else delete config.entity;
      this._dispatchConfig(config);
      this._renderEditor();
    });
    return form;
  }

  private _settingsSchema(): HaFormSchema[] {
    const t = makeLocalize(
      this._hass?.language ?? this._hass?.locale?.language ?? "en"
    );
    const appearance: HaFormFieldSchema[] = [
      { name: "name", label: t("editor.name_label"), selector: { text: {} } },
      { name: "icon", label: t("editor.icon_label"), selector: { icon: {} } },
      {
        name: "icon_color",
        label: t("editor.icon_color_label"),
        selector: { ui_color: {} },
      },
      {
        name: "hide_timestamps",
        label: t("editor.hide_timestamps"),
        selector: { boolean: {} },
      },
      {
        name: "hide_date_headers",
        label: t("editor.hide_date_headers"),
        selector: { boolean: {} },
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
    const history: HaFormFieldSchema[] = [
      {
        name: "hours_to_show",
        label: t("editor.hours_to_show"),
        selector: { number: { min: 1, mode: "box" } },
      },
      {
        name: "max_messages",
        label: t("editor.max_messages"),
        selector: { number: { min: 1, step: 1, mode: "box" } },
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
      section(t("editor.section_history"), "mdi:history", history),
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
      hide_timestamps: this._config?.hide_timestamps === true,
      hide_date_headers: this._config?.hide_date_headers === true,
      hours_to_show: normalizedPositiveNumber(
        this._config?.hours_to_show,
        DEFAULT_HOURS_TO_SHOW
      ),
      max_messages: Math.floor(
        normalizedPositiveNumber(
          this._config?.max_messages,
          DEFAULT_MAX_MESSAGES
        )
      ),
    };
    form.addEventListener("value-changed", (event: Event) => {
      const value = (
        event as CustomEvent<{ value: Record<string, unknown> }>
      ).detail.value;
      form.data = value;
      const config: MeshcoreChannelCardConfig = { ...this._config };
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
      const hours = Number(value["hours_to_show"]);
      if (Number.isFinite(hours) && hours >= 1 && hours !== DEFAULT_HOURS_TO_SHOW) {
        config.hours_to_show = hours;
      } else {
        delete config.hours_to_show;
      }
      const maximum = Number(value["max_messages"]);
      if (
        Number.isFinite(maximum) &&
        maximum >= 1 &&
        maximum !== DEFAULT_MAX_MESSAGES
      ) {
        config.max_messages = Math.floor(maximum);
      } else {
        delete config.max_messages;
      }
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
    const entityIds = this._channelEntities();
    if (!entityIds.length) {
      const t = makeLocalize(
        this._hass?.language ?? this._hass?.locale?.language ?? "en"
      );
      const alert = document.createElement("ha-alert") as HaAlertElement;
      alert.alertType = "info";
      alert.textContent = t("editor.no_channels_detected");
      container.appendChild(alert);
    } else {
      container.appendChild(this._targetForm(entityIds));
      if (this._config.entity) container.appendChild(this._settingsForm());
    }
    this.appendChild(container);
  }
}
