import { findEntityByDevice } from "./discovery.js";
import type { HomeAssistant } from "./types.js";

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
  eSuffix: string,
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
  return findEntityByDevice(entities, deviceId, metric, ePrefix, eSuffix);
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
