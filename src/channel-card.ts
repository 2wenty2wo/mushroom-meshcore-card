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
import { dateKey, dateLabel, timeLabel } from "./date-time.js";
import { escapeHtml } from "./helpers.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import { STYLES } from "./styles.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";

const CHANNEL_ENTITY_RE = /^binary_sensor\.meshcore_.*_ch_\d+_messages$/;
const DEFAULT_HOURS_TO_SHOW = 24;
const DEFAULT_MAX_MESSAGES = 200;
const LIVE_END_DAYS = 365;
const STREAM_RENDER_DELAY = 250;
const ROUTE_EVENT_TIME_WINDOW_MS = 100;
const ROUTE_MATCH_WINDOW_MS = 10_000;
const ROUTE_PENDING_TTL_MS = 60_000;
const MAX_ROUTE_HOPS = 63;
const MAX_ROUTE_HEX_CHARACTERS = 128;
const MAX_RX_LOG_ROUTES = 64;

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

  .message-route-details {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--mushroom-meshcore-chip-spacing) / 2);
    margin-top: 4px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .message-route-detail {
    box-sizing: border-box;
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    height: 20px;
    flex: 0 1 auto;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border: var(--mushroom-meshcore-chip-border-width) solid var(--mushroom-meshcore-chip-border-color);
    border-radius: var(--mushroom-meshcore-chip-radius);
    background: transparent;
  }

  .message-route-detail.hops { flex: 0 0 auto; }

  .message-route-detail ha-icon {
    --mdc-icon-size: 14px;
    flex: 0 0 auto;
  }

  .message-route-detail bdi {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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

interface HassEventEnvelope {
  event_type?: unknown;
  data?: unknown;
  context?: unknown;
  time_fired?: unknown;
}

interface NormalizedRxRoute {
  key: string;
  hopCount?: number;
  pathSegments?: string[];
  scope?: string;
  regionScoped: boolean;
}

interface RoutingRecord {
  entityId: string;
  sender: string;
  message: string;
  outgoing: boolean;
  timestampMs: number | null;
  eventTimeMs: number | null;
  contextId?: string;
  sendId?: string;
  signature?: string;
  topHopCount?: number;
  selectedRouteKey?: string;
  selectedRoute?: NormalizedRxRoute;
  outgoingScope?: string;
  messageEventSeen: boolean;
  matchedEntryKey?: string;
  matchedDistance?: number;
  matchAuthoritative?: boolean;
  updatedAt: number;
}

interface PendingSentScope {
  sendId: string;
  scope: string;
  message: string | null;
  timestampMs: number | null;
  expiresAt: number;
}

interface MessageRouteDetails {
  hopCount?: number;
  pathSegments?: string[];
  scope?: string;
  regionScoped?: boolean;
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

type RoutingEventType =
  | "meshcore_message"
  | "meshcore_delivery_update"
  | "meshcore_message_sent";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown, maximum = 4096): string | null {
  if (typeof value !== "string" || value.length > maximum || !value.trim()) {
    return null;
  }
  return value;
}

function eventIdentifier(value: unknown): string | null {
  const identifier = nonEmptyString(value, 256);
  return identifier?.trim() || null;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function routeHopCount(value: unknown): number | undefined {
  const count = nonNegativeInteger(value);
  return count !== undefined && count <= MAX_ROUTE_HOPS ? count : undefined;
}

function eventTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || value.length > 128 || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedScope(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256) return undefined;
  const scope = value
    .replace(
      /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return scope && scope !== "#" && scope.length <= 256 ? scope : undefined;
}

/** Split MeshCore's concatenated route hashes without assuming one-byte hops. */
export function splitRoutePath(
  value: unknown,
  pathLength: number | undefined,
  pathHashSize: unknown
): string[] | undefined {
  if (typeof value !== "string" || value.length > MAX_ROUTE_HEX_CHARACTERS) {
    return undefined;
  }
  const path = value.trim();
  if (
    !path ||
    !/^[0-9a-f]+$/i.test(path)
  ) {
    return undefined;
  }
  let segmentCharacters: number | undefined;
  if (pathHashSize !== undefined) {
    if (
      typeof pathHashSize !== "number" ||
      !Number.isInteger(pathHashSize) ||
      pathHashSize < 1 ||
      pathHashSize > 3
    ) {
      return undefined;
    }
    segmentCharacters = pathHashSize * 2;
  } else if (
    pathLength !== undefined &&
    pathLength > 0 &&
    path.length % pathLength === 0
  ) {
    const inferred = path.length / pathLength;
    if (inferred === 2 || inferred === 4 || inferred === 6) {
      segmentCharacters = inferred;
    }
  }
  if (
    segmentCharacters === undefined ||
    path.length % segmentCharacters !== 0 ||
    (pathLength !== undefined && path.length !== pathLength * segmentCharacters)
  ) {
    return undefined;
  }
  const segments: string[] = [];
  for (let index = 0; index < path.length; index += segmentCharacters) {
    segments.push(path.slice(index, index + segmentCharacters).toUpperCase());
  }
  return segments.length && segments.length <= MAX_ROUTE_HOPS
    ? segments
    : undefined;
}

export function compactRoutePath(segments: string[]): string {
  if (segments.length <= 4) return segments.join(",");
  return `${segments.slice(0, 2).join(",")},…,${segments.slice(-2).join(",")}`;
}

function normalizeRxRoute(value: unknown, index: number): NormalizedRxRoute | null {
  const route = asRecord(value);
  if (!route) return null;
  const hopCount = routeHopCount(route["path_len"]);
  const invalidPathLength =
    route["path_len"] !== undefined && hopCount === undefined;
  const pathSegments = invalidPathLength
    ? undefined
    : splitRoutePath(route["path"], hopCount, route["path_hash_size"]);
  const scope = normalizedScope(route["flood_scope"]);
  const regionScoped = route["region_scope"] === true;
  if (hopCount === undefined && !pathSegments && !scope && !regionScoped) return null;
  const timestamp = eventTimestamp(route["timestamp"]);
  const rawPath =
    pathSegments && typeof route["path"] === "string"
      ? route["path"].trim().toUpperCase()
      : "";
  return {
    key: [String(timestamp ?? ""), String(hopCount ?? ""), rawPath, String(index)].join(
      "\u0000"
    ),
    hopCount,
    pathSegments,
    scope,
    regionScoped,
  };
}

function routingSignature(
  entityId: string,
  outgoing: boolean,
  sender: string,
  message: string,
  timestampMs: number | null
): string | undefined {
  if (timestampMs === null) return undefined;
  return [
    entityId,
    outgoing ? "out" : "in",
    sender,
    message,
    String(timestampMs),
  ].join("\u0000");
}

export function normalizedPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : fallback;
}

export function parseChannel(
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
export function parseMessage(message: string): ParsedMessage | null {
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
  private _unsubscribes: Array<() => void | Promise<void>> = [];
  private _connection?: HomeAssistant["connection"];
  private _readyListenerAttached = false;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private _stateFingerprint = "";
  private _routingRecords = new Set<RoutingRecord>();
  private _routingByContext = new Map<string, RoutingRecord>();
  private _routingBySendId = new Map<string, RoutingRecord>();
  private _routingBySignature = new Map<string, RoutingRecord>();
  private _routingByEntry = new Map<string, RoutingRecord>();
  private _pendingSentScopes = new Map<string, PendingSentScope>();
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
      this._clearRoutingMetadata();
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
    this._unsubscribes = [];
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
    const unsubscribes = this._unsubscribes;
    this._unsubscribes = [];
    for (const unsubscribe of unsubscribes) {
      this._invokeUnsubscribe(unsubscribe);
    }
  }

  private _invokeUnsubscribe(unsubscribe: () => void | Promise<void>): void {
    try {
      void Promise.resolve(unsubscribe()).catch(() => {
        // A disconnected socket can leave a stale unsubscribe function.
      });
    } catch {
      // A disconnected socket can leave a stale unsubscribe function.
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
    let historyPromise: Promise<() => void | Promise<void>>;
    try {
      historyPromise = hass.connection.subscribeMessage<LogbookStreamMessage>(
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
    this._registerSubscription(historyPromise, subscriptionId, true);
    for (const eventType of [
      "meshcore_message",
      "meshcore_delivery_update",
      "meshcore_message_sent",
    ] as const) {
      this._subscribeRoutingEvent(hass, subscriptionId, eventType);
    }
  }

  private _registerSubscription(
    promise: Promise<() => void | Promise<void>>,
    subscriptionId: number,
    history: boolean
  ): void {
    void promise
      .then((unsubscribe) => {
        if (subscriptionId !== this._subscriptionId || !this._connected) {
          this._invokeUnsubscribe(unsubscribe);
          return;
        }
        this._unsubscribes.push(unsubscribe);
      })
      .catch(() => {
        if (subscriptionId !== this._subscriptionId) return;
        if (history) this._failHistorySubscription(subscriptionId);
      });
  }

  private _subscribeRoutingEvent(
    hass: HomeAssistant,
    subscriptionId: number,
    eventType: RoutingEventType
  ): void {
    if (!hass.connection) return;
    try {
      const promise = hass.connection.subscribeMessage<HassEventEnvelope>(
        (event) => {
          if (subscriptionId !== this._subscriptionId) return;
          this._processRoutingEvent(eventType, event);
        },
        { type: "subscribe_events", event_type: eventType },
        { resubscribe: false }
      );
      this._registerSubscription(promise, subscriptionId, false);
    } catch {
      // Routing details are optional; Logbook history remains usable.
    }
  }

  private _failHistorySubscription(subscriptionId: number): void {
    if (subscriptionId !== this._subscriptionId) return;
    this._stopSubscription();
    this._loading = false;
    this._historyError = true;
    this._render();
  }

  private _processRoutingEvent(
    eventType: RoutingEventType,
    event: HassEventEnvelope
  ): void {
    const outer = asRecord(event);
    const envelope = (outer && asRecord(outer["event"])) || outer;
    if (!envelope) return;
    if (envelope["event_type"] !== eventType) return;
    const data = asRecord(envelope["data"]);
    if (!data || data["message_type"] !== "channel") return;
    this._purgeRoutingMetadata();
    if (eventType === "meshcore_message_sent") {
      this._processMessageSent(data);
      return;
    }
    this._processMessageRouting(eventType, envelope, data);
  }

  private _selectedChannelIndex(): number {
    // Subscriptions only exist after _hasValidTarget validates this suffix.
    const match = this._config!.entity!.match(/_ch_(\d+)_messages$/)!;
    return Number.parseInt(match[1]!, 10);
  }

  private _selectedConfigEntryIds(): Set<string> {
    const entityId = this._config!.entity!;
    const deviceId = this._hass?.entities[entityId]?.device_id;
    const device = deviceId ? this._hass?.devices[deviceId] : undefined;
    const identifiers = new Set<string>();
    const primary = eventIdentifier(device?.primary_config_entry);
    if (primary) identifiers.add(primary);
    for (const value of device?.config_entries ?? []) {
      const identifier = eventIdentifier(value);
      if (identifier) identifiers.add(identifier);
    }
    return identifiers;
  }

  private _processMessageSent(data: Record<string, unknown>): void {
    const sendId = eventIdentifier(data["send_id"]);
    const scope = normalizedScope(data["scope"]);
    const channelIndex = nonNegativeInteger(data["channel_idx"]);
    const selectedIndex = this._selectedChannelIndex();
    if (!sendId || !scope || channelIndex === undefined || channelIndex !== selectedIndex) {
      return;
    }
    const selectedConfigEntryIds = this._selectedConfigEntryIds();
    const eventConfigEntryId =
      eventIdentifier(data["device"]) ?? eventIdentifier(data["entry_id"]);
    if (
      selectedConfigEntryIds.size > 0 &&
      eventConfigEntryId &&
      !selectedConfigEntryIds.has(eventConfigEntryId)
    ) {
      return;
    }
    const message =
      typeof data["message"] === "string" && data["message"].length <= 4096
        ? data["message"]
        : null;
    const pending: PendingSentScope = {
      sendId,
      scope,
      message,
      timestampMs:
        eventTimestamp(data["timestamp"]) ?? eventTimestamp(data["send_timestamp"]),
      expiresAt: Date.now() + ROUTE_PENDING_TTL_MS,
    };
    this._pendingSentScopes.delete(sendId);
    this._pendingSentScopes.set(sendId, pending);
    const maximum = Math.max(20, this._maxMessages() * 2);
    while (this._pendingSentScopes.size > maximum) {
      const oldest = this._pendingSentScopes.keys().next().value as string;
      this._pendingSentScopes.delete(oldest);
    }
    const record = this._routingBySendId.get(sendId);
    if (record && this._mergePendingSentScope(record, pending)) {
      this._scheduleRoutingRender(record);
    }
  }

  private _processMessageRouting(
    eventType: Exclude<RoutingEventType, "meshcore_message_sent">,
    envelope: Record<string, unknown>,
    data: Record<string, unknown>
  ): void {
    const selectedEntityId = this._config?.entity;
    const entityId = eventIdentifier(data["entity_id"]);
    const message = nonEmptyString(data["message"]);
    const sender = nonEmptyString(data["sender_name"], 512)?.trim();
    if (!selectedEntityId || entityId !== selectedEntityId || !message || !sender) {
      return;
    }
    if (data["channel_idx"] !== undefined) {
      const channelIndex = nonNegativeInteger(data["channel_idx"]);
      if (channelIndex === undefined || channelIndex !== this._selectedChannelIndex()) {
        return;
      }
    }
    if (
      data["outgoing"] !== undefined &&
      typeof data["outgoing"] !== "boolean"
    ) {
      return;
    }
    const outgoing = data["outgoing"] === true;
    const timestampMs =
      eventTimestamp(data["timestamp"]) ?? eventTimestamp(data["send_timestamp"]);
    const eventTimeMs =
      eventType === "meshcore_message"
        ? eventTimestamp(envelope["time_fired"])
        : null;
    const context = asRecord(envelope["context"]);
    const eventContextId = eventIdentifier(context?.["id"]);
    const contextId = eventType === "meshcore_message" ? eventContextId : null;
    const sendId = eventIdentifier(data["send_id"]);
    if (sendId && !outgoing) return;
    const signature = routingSignature(
      entityId,
      outgoing,
      sender,
      message,
      timestampMs ?? eventTimeMs
    );

    let record =
      (sendId ? this._routingBySendId.get(sendId) : undefined) ??
      (contextId ? this._routingByContext.get(contextId) : undefined) ??
      (signature ? this._routingBySignature.get(signature) : undefined);
    if (
      record &&
      (record.entityId !== entityId ||
        record.message !== message ||
        record.outgoing !== outgoing)
    ) {
      return;
    }
    if (!record) {
      if (!sendId && !contextId && !signature) return;
      record = {
        entityId,
        sender,
        message,
        outgoing,
        timestampMs,
        eventTimeMs,
        messageEventSeen: false,
        updatedAt: Date.now(),
      };
      this._routingRecords.add(record);
    }

    const previousDetails = JSON.stringify(this._routeDetails(record));
    record.timestampMs = record.timestampMs ?? timestampMs;
    if (eventType === "meshcore_message") {
      record.messageEventSeen = true;
      record.eventTimeMs = eventTimeMs ?? record.eventTimeMs;
    }
    record.updatedAt = Date.now();
    if (contextId) {
      record.contextId = contextId;
      this._routingByContext.set(contextId, record);
    }
    if (sendId) {
      record.sendId = sendId;
      this._routingBySendId.set(sendId, record);
    }
    if (signature) {
      record.signature = signature;
      this._routingBySignature.set(signature, record);
    }

    const topHopCount = routeHopCount(data["hop_count"]);
    if (topHopCount !== undefined) record.topHopCount = topHopCount;
    this._mergeRxLogData(record, data["rx_log_data"]);
    if (sendId) {
      const pending = this._pendingSentScopes.get(sendId);
      if (pending) this._mergePendingSentScope(record, pending);
    }
    const newlyMatched = this._matchRoutingRecord(record);
    const detailsChanged = previousDetails !== JSON.stringify(this._routeDetails(record));
    if (newlyMatched || detailsChanged) this._scheduleRoutingRender(record);
  }

  private _mergeRxLogData(record: RoutingRecord, value: unknown): void {
    if (!Array.isArray(value)) return;
    const routes: NormalizedRxRoute[] = [];
    const limit = Math.min(value.length, MAX_RX_LOG_ROUTES);
    for (let index = 0; index < limit; index += 1) {
      const route = normalizeRxRoute(value[index], index);
      if (route) routes.push(route);
    }
    if (!routes.length) return;
    const selected = record.selectedRouteKey
      ? routes.find((route) => route.key === record.selectedRouteKey)
      : routes[0];
    if (!selected) return;
    record.selectedRouteKey ??= selected.key;
    record.selectedRoute = selected;
  }

  private _mergePendingSentScope(
    record: RoutingRecord,
    pending: PendingSentScope
  ): boolean {
    if (
      !record.outgoing ||
      record.entityId !== this._config?.entity ||
      (pending.message !== null && pending.message !== record.message) ||
      (pending.timestampMs !== null &&
        record.timestampMs !== null &&
        Math.abs(pending.timestampMs - record.timestampMs) > ROUTE_MATCH_WINDOW_MS)
    ) {
      return false;
    }
    const changed = record.outgoingScope !== pending.scope;
    record.outgoingScope = pending.scope;
    this._pendingSentScopes.delete(pending.sendId);
    return changed;
  }

  private _routeDetails(record: RoutingRecord): MessageRouteDetails | null {
    const route = record.selectedRoute;
    const hopCount = route?.hopCount ?? record.topHopCount;
    const pathSegments = route?.pathSegments;
    const scope = record.outgoingScope ?? route?.scope;
    const regionScoped = !scope && route?.regionScoped === true;
    if (hopCount === undefined && !pathSegments && !scope && !regionScoped) return null;
    return { hopCount, pathSegments, scope, regionScoped };
  }

  private _scheduleRoutingRender(record: RoutingRecord): void {
    if (record.matchedEntryKey && this._entries.has(record.matchedEntryKey)) {
      this._scheduleRender();
    }
  }

  private _matchRoutingRecord(record: RoutingRecord): boolean {
    if (record.outgoing && !record.messageEventSeen) return false;
    if (record.matchedEntryKey && this._entries.has(record.matchedEntryKey)) {
      return false;
    }
    if (record.contextId) {
      for (const entry of this._entries.values()) {
        if (
          entry.context_id === record.contextId &&
          this._routingIdentityMatches(entry, record)
        ) {
          return this._assignRoutingRecord(entry, record, true);
        }
      }
    }
    const candidate = Array.from(this._entries.values())
      .map((entry) => ({ entry, distance: this._routingMatchDistance(entry, record) }))
      .filter(
        (item): item is { entry: LogbookEntry; distance: number } =>
          item.distance !== null &&
          (!this._routingByEntry.has(this._entryKey(item.entry)) ||
            this._routingByEntry.get(this._entryKey(item.entry)) === record)
      )
      .sort((a, b) => a.distance - b.distance)[0];
    return candidate
      ? this._assignRoutingRecord(candidate.entry, record, false, candidate.distance)
      : false;
  }

  private _matchEntryToRouting(entry: LogbookEntry): boolean {
    const entryKey = this._entryKey(entry);
    if (this._routingByEntry.has(entryKey)) return false;
    if (entry.context_id) {
      const contextRecord = this._routingByContext.get(entry.context_id);
      if (
        contextRecord &&
        this._routingIdentityMatches(entry, contextRecord)
      ) {
        return this._assignRoutingRecord(entry, contextRecord, true);
      }
    }
    const candidate = Array.from(this._routingRecords)
      .map((record) => ({ record, distance: this._routingMatchDistance(entry, record) }))
      .filter(
        (item): item is { record: RoutingRecord; distance: number } =>
          item.distance !== null &&
          (!item.record.outgoing || item.record.messageEventSeen) &&
          (!item.record.matchedEntryKey ||
            item.record.matchedEntryKey === entryKey ||
            // These fields are assigned and cleared as one match tuple.
            (item.record.matchAuthoritative !== true &&
              item.distance < item.record.matchedDistance!))
      )
      .sort((a, b) => a.distance - b.distance)[0];
    return candidate
      ? this._assignRoutingRecord(
          entry,
          candidate.record,
          false,
          candidate.distance
        )
      : false;
  }

  private _routingMatchDistance(
    entry: LogbookEntry,
    record: RoutingRecord
  ): number | null {
    if (entry.context_id && record.contextId && entry.context_id !== record.contextId) {
      return null;
    }
    if (!this._routingIdentityMatches(entry, record)) return null;
    const entryTime = entry.when * 1000;
    if (record.eventTimeMs !== null) {
      const eventDistance = Math.abs(record.eventTimeMs - entryTime);
      if (eventDistance <= ROUTE_EVENT_TIME_WINDOW_MS) return eventDistance;
    }
    if (record.timestampMs === null) return null;
    const timestampDistance = Math.abs(record.timestampMs - entryTime);
    return timestampDistance <= ROUTE_MATCH_WINDOW_MS
      ? ROUTE_EVENT_TIME_WINDOW_MS + timestampDistance
      : null;
  }

  private _routingIdentityMatches(
    entry: LogbookEntry,
    record: RoutingRecord
  ): boolean {
    // _entries contains only selected-entity rows accepted by parseMessage.
    const parsed = parseMessage(entry.message!)!;
    return (
      parsed.sender === record.sender &&
      parsed.body === record.message
    );
  }

  private _assignRoutingRecord(
    entry: LogbookEntry,
    record: RoutingRecord,
    authoritative: boolean,
    distance = 0
  ): boolean {
    const entryKey = this._entryKey(entry);
    const existing = this._routingByEntry.get(entryKey);
    if (existing && existing !== record) {
      // Non-authoritative candidates filter occupied entries before this call.
      existing.matchedEntryKey = undefined;
      existing.matchedDistance = undefined;
      existing.matchAuthoritative = undefined;
    }
    if (record.matchedEntryKey && record.matchedEntryKey !== entryKey) {
      this._routingByEntry.delete(record.matchedEntryKey);
    }
    record.matchedEntryKey = entryKey;
    record.matchedDistance = distance;
    record.matchAuthoritative = authoritative;
    this._routingByEntry.set(entryKey, record);
    return true;
  }

  private _clearRoutingMetadata(): void {
    this._routingRecords.clear();
    this._routingByContext.clear();
    this._routingBySendId.clear();
    this._routingBySignature.clear();
    this._routingByEntry.clear();
    this._pendingSentScopes.clear();
  }

  private _deleteRoutingRecord(record: RoutingRecord): void {
    this._routingRecords.delete(record);
    for (const lookup of [
      this._routingByContext,
      this._routingBySendId,
      this._routingBySignature,
      this._routingByEntry,
    ]) {
      for (const [key, candidate] of lookup) {
        if (candidate === record) lookup.delete(key);
      }
    }
  }

  private _purgeRoutingMetadata(retainedEntryKeys?: Set<string>): void {
    const now = Date.now();
    for (const [sendId, pending] of this._pendingSentScopes) {
      if (pending.expiresAt <= now) this._pendingSentScopes.delete(sendId);
    }
    for (const record of Array.from(this._routingRecords)) {
      if (
        (record.matchedEntryKey &&
          retainedEntryKeys &&
          !retainedEntryKeys.has(record.matchedEntryKey)) ||
        (!record.matchedEntryKey && record.updatedAt + ROUTE_PENDING_TTL_MS <= now)
      ) {
        this._deleteRoutingRecord(record);
      }
    }
    const maximum = Math.max(20, this._maxMessages() * 2);
    const excess = this._routingRecords.size - maximum;
    if (excess > 0) {
      const oldest = Array.from(this._routingRecords)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, excess);
      for (const record of oldest) this._deleteRoutingRecord(record);
    }
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
      this._matchEntryToRouting(entry);
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
    this._purgeRoutingMetadata(retainedKeys);
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

  private _dateKey(date: Date): string {
    return dateKey(this._hass, date);
  }

  private _dateLabel(date: Date): string {
    return dateLabel(this._hass, date, this._localize());
  }

  private _timeLabel(date: Date): string {
    return timeLabel(this._hass, date);
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
    const routeDetails = this._renderRouteDetails(entry);
    return `<article class="message-row">${meta}${body}${routeDetails}</article>`;
  }

  private _renderRouteDetails(entry: LogbookEntry): string {
    if (this._config?.hide_route_details) return "";
    const record = this._routingByEntry.get(this._entryKey(entry));
    const details = record ? this._routeDetails(record) : null;
    if (!details) return "";
    const t = this._localize();
    const pill = (
      kind: "hops" | "path" | "scope",
      icon: string,
      value: string,
      accessibleValue = value
    ): string => {
      const label = t(`card.channel_${kind}`);
      const accessibleLabel = `${label}: ${accessibleValue}`;
      return `<span class="message-route-detail ${kind}" title="${escapeHtml(
        accessibleLabel
      )}" aria-label="${escapeHtml(accessibleLabel)}"><ha-icon aria-hidden="true" icon="${icon}"></ha-icon><bdi dir="ltr">${escapeHtml(
        value
      )}</bdi></span>`;
    };
    const pills: string[] = [];
    if (details.hopCount !== undefined) {
      pills.push(
        pill(
          "hops",
          "mdi:transit-connection-variant",
          String(details.hopCount)
        )
      );
    }
    if (details.pathSegments?.length) {
      const fullPath = details.pathSegments.join(",");
      pills.push(pill("path", "mdi:routes", compactRoutePath(details.pathSegments), fullPath));
    }
    if (details.scope || details.regionScoped) {
      const fullScope = details.scope ?? t("card.channel_regional");
      const visibleScope = details.scope?.replace(/^#/, "") || fullScope;
      pills.push(pill("scope", "mdi:web", visibleScope, fullScope));
    }
    return `<div class="message-route-details" role="group" aria-label="${escapeHtml(
      t("card.channel_routing_details")
    )}">${pills.join("")}</div>`;
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
const BOOLEAN_SETTING_KEYS = [
  "hide_timestamps",
  "hide_date_headers",
  "hide_route_details",
] as const;
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
      {
        name: "hide_route_details",
        label: t("editor.hide_route_details"),
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
      hide_route_details: this._config?.hide_route_details === true,
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
