import type {
  MeshcoreCardConfig,
  MeshcoreCardTarget,
  MeshcoreChipId,
  MeshcoreChipLayout,
} from "./types.js";

export const NODE_CHIPS: readonly MeshcoreChipId[] = [
  "firmware",
  "sent",
  "received",
  "temperature",
  "uptime",
  "neighbor_count",
  "route",
  "path_length",
  "spreading_factor",
  "frequency",
  "bandwidth",
  "tx_power",
  "relayed",
  "canceled",
  "duplicate",
  "sent_direct",
  "sent_flood",
  "received_direct",
  "received_flood",
  "direct_duplicates",
  "flood_duplicates",
  "queue_full_events",
  "receive_errors",
  "tx_airtime",
  "rx_airtime",
  "tx_airtime_total",
  "rx_airtime_total",
  "queue_length",
  "tx_rate",
  "rx_rate",
  "sent_direct_rate",
  "sent_flood_rate",
  "received_direct_rate",
  "received_flood_rate",
  "direct_duplicates_rate",
  "flood_duplicates_rate",
  "receive_errors_rate",
  "request_successes",
  "request_failures",
  "humidity",
  "illuminance",
  "pressure",
];

export const HUB_CHIPS: readonly MeshcoreChipId[] = [
  "hardware",
  "firmware",
  "frequency",
  "bandwidth",
  "spreading_factor",
  "tx_power",
  "ch1_voltage",
  "rate_limiter",
];

const NODE_TOP: readonly MeshcoreChipId[] = [
  "sent",
  "received",
  "temperature",
  "uptime",
  "neighbor_count",
];

const NODE_DETAILS: readonly MeshcoreChipId[] = [
  "route",
  "path_length",
  "spreading_factor",
  "frequency",
  "bandwidth",
  "tx_power",
  "relayed",
  "sent_direct",
  "sent_flood",
  "received_direct",
  "received_flood",
  "tx_airtime",
  "rx_airtime",
  "tx_airtime_total",
  "rx_airtime_total",
  "tx_rate",
  "rx_rate",
  "sent_direct_rate",
  "sent_flood_rate",
  "received_direct_rate",
  "received_flood_rate",
  "direct_duplicates_rate",
  "flood_duplicates_rate",
  "receive_errors_rate",
  "canceled",
  "duplicate",
  "direct_duplicates",
  "flood_duplicates",
  "queue_length",
  "queue_full_events",
  "receive_errors",
  "request_successes",
  "request_failures",
  "humidity",
  "illuminance",
  "pressure",
];

const HUB_TOP: readonly MeshcoreChipId[] = ["hardware", "firmware"];
const HUB_DETAILS: readonly MeshcoreChipId[] = [
  "frequency",
  "bandwidth",
  "spreading_factor",
  "tx_power",
  "ch1_voltage",
  "rate_limiter",
];

export function chipIdsForTarget(target: MeshcoreCardTarget): readonly MeshcoreChipId[] {
  return target.type === "node" ? NODE_CHIPS : HUB_CHIPS;
}

export function defaultChipLayout(
  target: MeshcoreCardTarget,
  config: Pick<MeshcoreCardConfig, "hide_quick_stats" | "show_firmware"> = {}
): MeshcoreChipLayout {
  const top = [...(target.type === "node" ? NODE_TOP : HUB_TOP)];
  const details = [...(target.type === "node" ? NODE_DETAILS : HUB_DETAILS)];
  const hidden: MeshcoreChipId[] = [];

  if (target.type === "node") {
    if (config.show_firmware) top.unshift("firmware");
    else hidden.push("firmware");
  }

  if (config.hide_quick_stats) {
    hidden.push(...top);
    top.length = 0;
  }

  return { top, details, hidden };
}

/** Normalize user YAML into a complete, unique partition of supported chips. */
export function effectiveChipLayout(
  target: MeshcoreCardTarget,
  config: MeshcoreCardConfig
): MeshcoreChipLayout {
  if (!config.chip_layout) return defaultChipLayout(target, config);

  const supported = new Set(chipIdsForTarget(target));
  const seen = new Set<MeshcoreChipId>();
  const take = (values: unknown): MeshcoreChipId[] => {
    if (!Array.isArray(values)) return [];
    const result: MeshcoreChipId[] = [];
    for (const value of values) {
      if (typeof value !== "string" || !supported.has(value as MeshcoreChipId)) continue;
      const id = value as MeshcoreChipId;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  };

  const top = take(config.chip_layout.top);
  const details = take(config.chip_layout.details);
  const hidden = take(config.chip_layout.hidden);
  for (const id of chipIdsForTarget(target)) {
    if (!seen.has(id)) hidden.push(id);
  }
  return { top, details, hidden };
}
