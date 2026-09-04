import { findEntityByDevice } from "./discovery.js";
import type { HomeAssistant, NodeInfo } from "./types.js";

export interface EntityLookupOptions {
  domain?: string;
  enabledOnly?: boolean;
  platform?: string;
}

/** Resolve one device-scoped metric while retaining the discovery module's
 * exact-before-compatibility matching order. */
export function findScopedEntity(
  hass: Pick<HomeAssistant, "entities" | "states">,
  deviceId: string,
  metric: string,
  ePrefix: string,
  eSuffixes: readonly string[],
  options: EntityLookupOptions = {}
): string | null {
  const entities = Object.fromEntries(
    Object.entries(hass.entities ?? {}).filter(([entityId, info]) => {
      if (info.device_id !== deviceId) return false;
      if (options.domain && !entityId.startsWith(`${options.domain}.`)) {
        return false;
      }
      if (options.platform && info.platform !== options.platform) return false;
      if (options.enabledOnly && info.disabled_by != null) return false;
      return true;
    })
  );
  return findEntityByDevice(entities, deviceId, metric, ePrefix, eSuffixes);
}

export type ExplicitConnectivityState = "online" | "offline" | "unknown";

/** Parse only explicit connectivity states. This deliberately avoids normal
 * JavaScript truthiness, which treats strings such as "off" as true. */
export function normalizeConnectivityState(
  value: unknown
): ExplicitConnectivityState {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["on", "online", "connected", "true", "1"].includes(normalized)) {
    return "online";
  }
  if (["off", "offline", "disconnected", "false", "0"].includes(normalized)) {
    return "offline";
  }
  return "unknown";
}

export interface NodeConnectivity {
  state: ExplicitConnectivityState;
  /** The entity that decided the state; null when nothing resolved. */
  entityId: string | null;
  source:
    | "binary_online"
    | "legacy_status"
    | "uptime"
    | "request_successes"
    | "none";
  /** Enabled meshcore `binary_sensor` `online`. A discovery result, so it is
   *  populated regardless of whether that entity has a usable state. */
  binaryEntityId: string | null;
  /** Legacy `sensor` `online` ?? `sensor` `status`, likewise state-independent. */
  statusEntityId: string | null;
}

const UPTIME_FRESH_MS = 6 * 3600 * 1000;

/** Decide whether one managed node is reachable.
 *
 *  Shared by the node card and the status model so the two surfaces cannot
 *  drift: they previously ran separate chains, and a node whose dedicated
 *  sensor failed to resolve read "Online" on one and "Unknown" on the other.
 *
 *  Explicit signals beat heuristics — a state the integration reported is
 *  better evidence than a freshness guess, not least because `last_updated`
 *  also moves on a Home Assistant restart. */
export function resolveNodeConnectivity(
  hass: Pick<HomeAssistant, "entities" | "states">,
  node: NodeInfo,
  options: { now?: number } = {}
): NodeConnectivity {
  const scoped = (metric: string, domain?: string): string | null =>
    findScopedEntity(hass, node.deviceId, metric, node.ePrefix, node.eSuffixes, {
      domain,
      enabledOnly: true,
      platform: "meshcore",
    });

  const binaryEntityId = scoped("online", "binary_sensor");
  const statusEntityId =
    scoped("online", "sensor") ?? scoped("status", "sensor");
  const base = { binaryEntityId, statusEntityId };

  // meshcore-ha's dedicated connectivity sensor is authoritative when present,
  // including its unknown state — that means "not yet polled successfully this
  // session", which is a real answer rather than a gap to paper over.
  if (binaryEntityId) {
    return {
      ...base,
      state: normalizeConnectivityState(hass.states[binaryEntityId]?.state),
      entityId: binaryEntityId,
      source: "binary_online",
    };
  }

  const statusState = statusEntityId
    ? normalizeConnectivityState(hass.states[statusEntityId]?.state)
    : "unknown";
  if (statusEntityId && statusState !== "unknown") {
    return {
      ...base,
      state: statusState,
      entityId: statusEntityId,
      source: "legacy_status",
    };
  }

  // Compatibility for integrations with no usable explicit connectivity state.
  const uptimeId = scoped("uptime");
  const uptime = uptimeId ? hass.states[uptimeId] : undefined;
  if (uptime) {
    // An unavailable uptime still carries a current `last_updated`, so the
    // freshness check has to be gated on the state being readable.
    const timestamp = new Date(uptime.last_updated).getTime();
    const fresh =
      !isUnavailableState(uptime.state) &&
      !Number.isNaN(timestamp) &&
      (options.now ?? Date.now()) - timestamp < UPTIME_FRESH_MS;
    return {
      ...base,
      state: fresh ? "online" : "offline",
      entityId: uptimeId,
      source: "uptime",
    };
  }

  const successId = scoped("request_successes");
  const successes = successId ? Number(hass.states[successId]?.state) : Number.NaN;
  if (Number.isFinite(successes)) {
    return {
      ...base,
      state: successes > 0 ? "online" : "offline",
      entityId: successId,
      source: "request_successes",
    };
  }

  if (statusEntityId) {
    return {
      ...base,
      state: "unknown",
      entityId: statusEntityId,
      source: "legacy_status",
    };
  }

  return { ...base, state: "unknown", entityId: null, source: "none" };
}

export function isUnavailableState(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "none" ||
    normalized === "null"
  );
}
