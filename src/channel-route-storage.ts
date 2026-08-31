import type { HomeAssistant } from "./types.js";

/** The single per-user frontend-storage namespace used by the channel card. */
export const CHANNEL_ROUTE_STORAGE_KEY =
  "mushroom_meshcore_channel_route_cache_v1";

export const CHANNEL_ROUTE_STORAGE_VERSION = 1 as const;
export const MAX_ROUTE_STORAGE_RECORDS_PER_TARGET = 200;
export const MAX_ROUTE_STORAGE_RECORDS = 1_000;
export const MAX_ROUTE_STORAGE_TARGETS = 128;
export const MAX_ROUTE_STORAGE_ROUTES = 64;
export const MAX_ROUTE_STORAGE_HOPS = 63;
export const MAX_ROUTE_STORAGE_PATH_SEGMENTS = 63;
export const MAX_ROUTE_STORAGE_SCOPE_LENGTH = 256;
export const MAX_ROUTE_STORAGE_KEY_LENGTH = 512;

export type RouteStorageHashSizeBytes = 1 | 2 | 3;

/** The serializable subset of a live channel route. */
export interface SerializedRoute {
  key?: string;
  hopCount?: number;
  pathSegments?: string[];
  hashSizeBytes?: RouteStorageHashSizeBytes;
  direct: boolean;
  scope?: string;
  regionScoped: boolean;
}

/** A route record attached to one actual Logbook message. */
export interface RouteStorageRecord {
  when: number;
  updatedAt: number;
  outgoing: boolean;
  topHopCount?: number;
  selectedRouteKey?: string;
  selectedRoute?: SerializedRoute;
  routes: SerializedRoute[];
  outgoingScope?: string;
}

export interface RouteStorageTarget {
  [messageIdentity: string]: RouteStorageRecord;
}

export interface RouteStorageEnvelope {
  version: typeof CHANNEL_ROUTE_STORAGE_VERSION;
  targets: Record<string, RouteStorageTarget>;
}

export interface RouteStorageIdentityInput {
  /** A native HA context ID, when one is available. */
  contextId?: unknown;
  /** The exact key returned by the card's Logbook-entry key helper. */
  entryKey?: unknown;
  entityId?: unknown;
  when?: unknown;
  message?: unknown;
}

export interface RouteStoragePruneOptions {
  /** Logbook timestamps are seconds since epoch. */
  nowSeconds?: number;
  /** Apply configured retention only to this target; hard bounds remain global. */
  targetId?: string;
  hoursToShow?: number;
  maxMessages?: number;
}

interface HassUserDataMessage {
  key?: unknown;
  value?: unknown;
}

export interface RouteStorageLoadResult {
  envelope: RouteStorageEnvelope;
  available: boolean;
}

const routeStorageWriteQueues = new WeakMap<object, Promise<void>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return undefined;
  }
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function identityPart(value: unknown, maximum = 4096): string {
  return typeof value === "string" && value.length <= maximum ? value : "";
}

function safeObjectKey(value: string): boolean {
  return value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : undefined;
}

function positiveTimestamp(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function normalizeHashSize(value: unknown): RouteStorageHashSizeBytes | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function normalizeRoute(value: unknown): SerializedRoute | null {
  const route = asRecord(value);
  if (!route || typeof route["direct"] !== "boolean" ||
      typeof route["regionScoped"] !== "boolean") {
    return null;
  }

  const normalized: SerializedRoute = {
    direct: route["direct"],
    regionScoped: route["regionScoped"],
  };
  const key = boundedString(route["key"], MAX_ROUTE_STORAGE_KEY_LENGTH);
  if (route["key"] !== undefined && !key) return null;
  if (key) normalized.key = key;

  const hopCount = nonNegativeInteger(route["hopCount"], MAX_ROUTE_STORAGE_HOPS);
  if (route["hopCount"] !== undefined && hopCount === undefined) return null;
  if (hopCount !== undefined) normalized.hopCount = hopCount;

  const hashSizeBytes = normalizeHashSize(route["hashSizeBytes"]);
  if (route["hashSizeBytes"] !== undefined && hashSizeBytes === undefined) {
    return null;
  }
  if (hashSizeBytes !== undefined) normalized.hashSizeBytes = hashSizeBytes;

  const scope = boundedString(route["scope"], MAX_ROUTE_STORAGE_SCOPE_LENGTH);
  if (route["scope"] !== undefined && !scope) return null;
  if (scope) normalized.scope = scope;

  if (route["pathSegments"] !== undefined) {
    const pathSegments = route["pathSegments"];
    if (!Array.isArray(pathSegments) ||
        pathSegments.length === 0 ||
        pathSegments.length > MAX_ROUTE_STORAGE_PATH_SEGMENTS) {
      return null;
    }
    const normalizedSegments: string[] = [];
    for (const segment of pathSegments) {
      if (
        typeof segment !== "string" ||
        segment.length < 2 ||
        segment.length > 6 ||
        segment.length % 2 !== 0 ||
        !/^[0-9a-f]+$/i.test(segment)
      ) {
        return null;
      }
      normalizedSegments.push(segment.toUpperCase());
    }
    normalized.pathSegments = normalizedSegments;
  }

  return normalized;
}

function cloneRoute(route: SerializedRoute): SerializedRoute {
  return {
    ...route,
    ...(route.pathSegments ? { pathSegments: route.pathSegments.slice() } : {}),
  };
}

function normalizeStorageRecord(value: unknown): RouteStorageRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const when = positiveTimestamp(record["when"]);
  const updatedAt = positiveTimestamp(record["updatedAt"]);
  if (when === undefined || updatedAt === undefined ||
      typeof record["outgoing"] !== "boolean" ||
      !Array.isArray(record["routes"])) {
    return null;
  }

  const topHopCount = nonNegativeInteger(
    record["topHopCount"],
    MAX_ROUTE_STORAGE_HOPS
  );
  if (record["topHopCount"] !== undefined && topHopCount === undefined) {
    return null;
  }
  const selectedRouteKey = boundedString(
    record["selectedRouteKey"],
    MAX_ROUTE_STORAGE_KEY_LENGTH
  );
  if (record["selectedRouteKey"] !== undefined && !selectedRouteKey) return null;

  const outgoingScope = boundedString(
    record["outgoingScope"],
    MAX_ROUTE_STORAGE_SCOPE_LENGTH
  );
  if (record["outgoingScope"] !== undefined && !outgoingScope) return null;

  if (record["routes"].length > MAX_ROUTE_STORAGE_ROUTES) return null;
  const routes: SerializedRoute[] = [];
  for (const value of record["routes"]) {
    const route = normalizeRoute(value);
    if (!route) return null;
    routes.push(route);
  }

  let selectedRoute: SerializedRoute | undefined;
  if (record["selectedRoute"] !== undefined) {
    selectedRoute = normalizeRoute(record["selectedRoute"]) ?? undefined;
    if (!selectedRoute) return null;
  }

  return {
    when,
    updatedAt,
    outgoing: record["outgoing"],
    routes,
    ...(topHopCount !== undefined ? { topHopCount } : {}),
    ...(selectedRouteKey ? { selectedRouteKey } : {}),
    ...(selectedRoute ? { selectedRoute: cloneRoute(selectedRoute) } : {}),
    ...(outgoingScope ? { outgoingScope } : {}),
  };
}

function cloneRecord(record: RouteStorageRecord): RouteStorageRecord {
  return {
    ...record,
    routes: record.routes.map(cloneRoute),
    ...(record.selectedRoute
      ? { selectedRoute: cloneRoute(record.selectedRoute) }
      : {}),
  };
}

function cloneEnvelope(envelope: RouteStorageEnvelope): RouteStorageEnvelope {
  const targets: Record<string, RouteStorageTarget> = {};
  for (const [target, records] of Object.entries(envelope.targets)) {
    targets[target] = {};
    for (const [identity, record] of Object.entries(records)) {
      targets[target]![identity] = cloneRecord(record);
    }
  }
  return { version: CHANNEL_ROUTE_STORAGE_VERSION, targets };
}

/** Create an empty, valid cache envelope. */
export function emptyRouteStorage(): RouteStorageEnvelope {
  return { version: CHANNEL_ROUTE_STORAGE_VERSION, targets: {} };
}

/**
 * Validate and normalize a value received from frontend user storage.
 * Invalid records and target namespaces are ignored; valid data is capped.
 */
export function validateRouteStorage(value: unknown): RouteStorageEnvelope {
  const root = asRecord(value);
  if (root?.["version"] !== CHANNEL_ROUTE_STORAGE_VERSION) {
    return emptyRouteStorage();
  }
  const rawTargets = asRecord(root["targets"]);
  if (!rawTargets) return emptyRouteStorage();

  const envelope = emptyRouteStorage();
  for (const [target, rawRecords] of Object.entries(rawTargets)) {
    if (
      Object.keys(envelope.targets).length >= MAX_ROUTE_STORAGE_TARGETS ||
      !boundedString(target, MAX_ROUTE_STORAGE_KEY_LENGTH) ||
      !safeObjectKey(target)
    ) {
      continue;
    }
    const records = asRecord(rawRecords);
    if (!records) continue;
    const valid: RouteStorageTarget = {};
    for (const [identity, rawRecord] of Object.entries(records)) {
      if (
        Object.keys(valid).length >= MAX_ROUTE_STORAGE_RECORDS_PER_TARGET ||
        !boundedString(identity, MAX_ROUTE_STORAGE_KEY_LENGTH) ||
        !safeObjectKey(identity)
      ) {
        continue;
      }
      const record = normalizeStorageRecord(rawRecord);
      if (record) valid[identity] = record;
    }
    if (Object.keys(valid).length) envelope.targets[target] = valid;
  }
  return pruneRouteStorage(envelope);
}

/** Return a defensive copy of a validated envelope. */
export function cloneRouteStorage(value: unknown): RouteStorageEnvelope {
  return cloneEnvelope(validateRouteStorage(value));
}

function recordSortTime(record: RouteStorageRecord): number {
  return Math.max(record.updatedAt, record.when * 1000);
}

/**
 * Merge two validated or untrusted envelopes by message identity. Newer
 * records win; equal timestamps use the incoming record so a native update
 * can replace a hydrated record deterministically.
 */
export function mergeRouteStorage(
  first: unknown,
  second: unknown
): RouteStorageEnvelope {
  const left = validateRouteStorage(first);
  const right = validateRouteStorage(second);
  const merged = cloneEnvelope(left);

  for (const [target, incomingRecords] of Object.entries(right.targets)) {
    const current = (merged.targets[target] ??= {});
    for (const [identity, incoming] of Object.entries(incomingRecords)) {
      const existing = current[identity];
      if (!existing || incoming.updatedAt >= existing.updatedAt) {
        current[identity] = cloneRecord(incoming);
      }
    }
  }
  return pruneRouteStorage(merged);
}

/**
 * Apply configured history retention and the hard storage bounds. When a
 * target is supplied, its card-specific retention never affects another
 * channel namespace. Records are newest-first when a cap is hit.
 */
export function pruneRouteStorage(
  value: unknown,
  options: RouteStoragePruneOptions = {}
): RouteStorageEnvelope {
  const source = value === null ? emptyRouteStorage() : validateEnvelopeOnly(value);
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000;
  const hoursToShow = options.hoursToShow;
  const cutoff = hoursToShow !== undefined &&
      Number.isFinite(hoursToShow) &&
      hoursToShow >= 0
    ? nowSeconds - hoursToShow * 60 * 60
    : undefined;
  const maxMessages = options.maxMessages !== undefined &&
      Number.isSafeInteger(options.maxMessages) &&
      options.maxMessages >= 0
    ? Math.min(options.maxMessages, MAX_ROUTE_STORAGE_RECORDS_PER_TARGET)
    : MAX_ROUTE_STORAGE_RECORDS_PER_TARGET;
  const configuredTarget = options.targetId;

  const result = emptyRouteStorage();
  const all: Array<{ target: string; identity: string; record: RouteStorageRecord }> = [];
  for (const [target, records] of Object.entries(source.targets)) {
    const applyConfiguredRetention = target === configuredTarget;
    const candidates = Object.entries(records)
      .filter(
        ([, record]) =>
          !applyConfiguredRetention ||
          cutoff === undefined ||
          record.when >= cutoff
      )
      .sort(([, a], [, b]) => recordSortTime(b) - recordSortTime(a))
      .slice(
        0,
        applyConfiguredRetention
          ? maxMessages
          : MAX_ROUTE_STORAGE_RECORDS_PER_TARGET
      );
    if (!candidates.length) continue;
    result.targets[target] = {};
    for (const [identity, record] of candidates) {
      const cloned = cloneRecord(record);
      result.targets[target]![identity] = cloned;
      all.push({ target, identity, record: cloned });
    }
  }

  if (all.length > MAX_ROUTE_STORAGE_RECORDS) {
    const keep = new Set(
      all
        .sort((a, b) => recordSortTime(b.record) - recordSortTime(a.record))
        .slice(0, MAX_ROUTE_STORAGE_RECORDS)
        .map((item) => `${item.target}\u0000${item.identity}`)
    );
    for (const [target, records] of Object.entries(result.targets)) {
      for (const identity of Object.keys(records)) {
        if (!keep.has(`${target}\u0000${identity}`)) delete records[identity];
      }
      if (!Object.keys(records).length) delete result.targets[target];
    }
  }
  return result;
}

/** Validate without applying time/size retention a second time. */
function validateEnvelopeOnly(value: unknown): RouteStorageEnvelope {
  const root = asRecord(value);
  if (root?.["version"] !== CHANNEL_ROUTE_STORAGE_VERSION) return emptyRouteStorage();
  const rawTargets = asRecord(root["targets"]);
  if (!rawTargets) return emptyRouteStorage();
  const envelope = emptyRouteStorage();
  for (const [target, rawRecords] of Object.entries(rawTargets)) {
    if (Object.keys(envelope.targets).length >= MAX_ROUTE_STORAGE_TARGETS ||
        !boundedString(target, MAX_ROUTE_STORAGE_KEY_LENGTH) ||
        !safeObjectKey(target)) continue;
    const records = asRecord(rawRecords);
    if (!records) continue;
    const valid: RouteStorageTarget = {};
    for (const [identity, rawRecord] of Object.entries(records)) {
      if (Object.keys(valid).length >= MAX_ROUTE_STORAGE_RECORDS_PER_TARGET ||
          !boundedString(identity, MAX_ROUTE_STORAGE_KEY_LENGTH) ||
          !safeObjectKey(identity)) continue;
      const record = normalizeStorageRecord(rawRecord);
      if (record) valid[identity] = record;
    }
    if (Object.keys(valid).length) envelope.targets[target] = valid;
  }
  return envelope;
}

function exactEntryKey(input: RouteStorageIdentityInput): string {
  return input.entryKey !== undefined
    ? identityPart(input.entryKey)
    : [
      identityPart(input.entityId),
      String(input.when ?? ""),
      identityPart(input.contextId),
      identityPart(input.message),
    ].join("\u0000");
}

function contextIdentity(value: unknown): string | undefined {
  const context = boundedString(value, MAX_ROUTE_STORAGE_KEY_LENGTH);
  return context ? `context:${context}` : undefined;
}

function fallbackDigest(value: string): string {
  // Two independent 32-bit FNV-1a streams provide a deterministic opaque key
  // for old browsers where Web Crypto is unavailable.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x01000193) >>> 0;
  }
  return `fallback:${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Build the stable record identity. Native context IDs take precedence; the
 * fallback hashes the exact key used for a Logbook row.
 */
export async function routeStorageIdentity(
  input: RouteStorageIdentityInput
): Promise<string> {
  const context = contextIdentity(input.contextId);
  if (context) return context;
  const key = exactEntryKey(input);
  try {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.subtle && typeof TextEncoder !== "undefined") {
      const bytes = new TextEncoder().encode(key);
      const digest = await cryptoObject.subtle.digest("SHA-256", bytes);
      return `sha256:${bytesToHex(digest)}`;
    }
  } catch {
    // Fall through to the deterministic legacy-browser key.
  }
  return fallbackDigest(key);
}

/** Alias kept explicit for callers that already use “message” terminology. */
export const messageRouteStorageIdentity = routeStorageIdentity;

function storageValue(value: unknown): unknown {
  const message = asRecord(value) as HassUserDataMessage | null;
  return message && Object.prototype.hasOwnProperty.call(message, "value")
    ? message.value
    : value;
}

/** Load and validate the current user's channel-route cache. */
export async function loadRouteStorageResult(
  hass: HomeAssistant | undefined
): Promise<RouteStorageLoadResult> {
  if (!hass?.callWS) return { envelope: emptyRouteStorage(), available: false };
  try {
    const response = await hass.callWS<unknown>({
      type: "frontend/get_user_data",
      key: CHANNEL_ROUTE_STORAGE_KEY,
    });
    return {
      envelope: validateRouteStorage(storageValue(response)),
      available: true,
    };
  } catch {
    return { envelope: emptyRouteStorage(), available: false };
  }
}

/** Load and validate the current user's cache, retaining the legacy envelope-only API. */
export async function loadRouteStorage(
  hass: HomeAssistant | undefined
): Promise<RouteStorageEnvelope> {
  return (await loadRouteStorageResult(hass)).envelope;
}

/** Save a validated cache envelope for the current user. */
export async function saveRouteStorage(
  hass: HomeAssistant | undefined,
  value: unknown
): Promise<boolean> {
  if (!hass?.callWS) return false;
  try {
    await hass.callWS({
      type: "frontend/set_user_data",
      key: CHANNEL_ROUTE_STORAGE_KEY,
      value: validateRouteStorage(value),
    });
    return true;
  } catch {
    return false;
  }
}

function routeStorageWriteQueueKey(
  hass: HomeAssistant | undefined
): object | undefined {
  if (hass?.connection && typeof hass.connection === "object") {
    return hass.connection;
  }
  return hass && typeof hass === "object" ? hass : undefined;
}

/**
 * Serialize a complete read/merge/write transaction across every channel-card
 * instance sharing the same Home Assistant connection. Rejections do not
 * poison later writes in the queue.
 */
export async function runSerializedRouteStorageWrite<T>(
  hass: HomeAssistant | undefined,
  operation: () => Promise<T>
): Promise<T> {
  const key = routeStorageWriteQueueKey(hass);
  if (!key) return operation();

  const previous = routeStorageWriteQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  routeStorageWriteQueues.set(key, tail);
  try {
    return await current;
  } finally {
    if (routeStorageWriteQueues.get(key) === tail) {
      routeStorageWriteQueues.delete(key);
    }
  }
}

/** Subscribe to another tab/device updating the current user's cache. */
export async function subscribeRouteStorage(
  hass: HomeAssistant | undefined,
  callback: (value: RouteStorageEnvelope) => void
): Promise<() => void | Promise<void>> {
  if (!hass?.callWS || !hass.connection?.subscribeMessage) return () => undefined;
  try {
    return await hass.connection.subscribeMessage<HassUserDataMessage | unknown>(
      (message) => callback(validateRouteStorage(storageValue(message))),
      {
        type: "frontend/subscribe_user_data",
        key: CHANNEL_ROUTE_STORAGE_KEY,
      },
      { resubscribe: false }
    );
  } catch {
    return () => undefined;
  }
}
