import type { HassEntities } from "home-assistant-js-websocket";

// ── Home Assistant registry types ────────────────────────────────────────────

export interface HassEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  platform: string;
  name: string | null;
  icon: string | null;
  disabled_by: string | null;
}

export interface HassDeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  sw_version?: string | null;
  via_device_id?: string | null;
}

/** The `hass` object passed to Lovelace custom cards by the HA frontend. */
export interface HomeAssistant {
  states: HassEntities;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDeviceRegistryEntry>;
  themes: Record<string, unknown>;
  language: string;
  localize?: (key: string, ...args: unknown[]) => string;
  locale: {
    language: string;
    time_format?: "12" | "24" | "language" | "system";
    time_zone?: "local" | "server";
  };
  config?: {
    components?: string[];
    time_zone?: string;
  };
  connection?: {
    subscribeMessage: <T>(
      callback: (message: T) => void,
      params: Record<string, unknown>,
      options?: { resubscribe?: boolean }
    ) => Promise<() => void>;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  callService?: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: ActionTarget
  ) => Promise<unknown> | void;
}

// ── Action config types (Mushroom/Tile-compatible subset) ─────────────────────

export interface ActionTarget {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
}

export interface ActionConfig {
  action:
    | "more-info"
    | "navigate"
    | "url"
    | "perform-action"
    | "call-service"
    | "none";
  navigation_path?: string;
  url_path?: string;
  /** "domain.service" — newer HA name. */
  perform_action?: string;
  /** "domain.service" — legacy call-service name. */
  service?: string;
  data?: Record<string, unknown>;
  service_data?: Record<string, unknown>;
  target?: ActionTarget;
  confirmation?: boolean | { text?: string };
}

// ── Card config types ─────────────────────────────────────────────────────────

export type MeshcoreCardTarget =
  | { type: "hub"; id: string }
  | { type: "node"; id: string };

export type MeshcoreChipId =
  | "hardware"
  | "firmware"
  | "sent"
  | "received"
  | "temperature"
  | "uptime"
  | "neighbor_count"
  | "route"
  | "path_length"
  | "spreading_factor"
  | "frequency"
  | "bandwidth"
  | "tx_power"
  | "relayed"
  | "canceled"
  | "duplicate"
  | "tx_airtime"
  | "rx_airtime"
  | "queue_length"
  | "tx_rate"
  | "rx_rate"
  | "humidity"
  | "illuminance"
  | "pressure"
  | "ch1_voltage"
  | "rate_limiter";

export interface MeshcoreChipLayout {
  top: MeshcoreChipId[];
  details: MeshcoreChipId[];
  hidden: MeshcoreChipId[];
}

export interface GridOptions {
  rows?: number | "auto";
  columns?: number | "full";
  min_rows?: number;
  max_rows?: number;
  min_columns?: number;
  max_columns?: number;
}

export interface MeshcoreCardConfig {
  type?: string;
  target?: MeshcoreCardTarget;
  name?: string;
  icon?: string;
  icon_color?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  hide_battery?: boolean;
  hide_metrics?: boolean;
  hide_quick_stats?: boolean;
  show_firmware?: boolean;
  hide_details?: boolean;
  details_default_open?: boolean;
  chip_layout?: MeshcoreChipLayout;
  battery_entity?: string;
  voltage_entity?: string;
  location_entity?: string;
  temperature_entity?: string;
  humidity_entity?: string;
  illuminance_entity?: string;
  pressure_entity?: string;
  show_neighbors?: boolean;
  max_neighbors?: number;
  map_provider?: string;
  map_metro?: string;
  grid_options?: GridOptions;
}

export interface MeshcoreChannelCardConfig {
  type?: string;
  entity?: string;
  name?: string;
  icon?: string;
  icon_color?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  hide_timestamps?: boolean;
  hide_date_headers?: boolean;
  hours_to_show?: number;
  max_messages?: number;
  grid_options?: GridOptions;
}

export interface MeshcoreMentionsCardConfig {
  type?: string;
  entity?: string;
  name?: string;
  icon?: string;
  icon_color?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  /** Completed mentions are hidden unless this is explicitly false. */
  hide_completed?: boolean;
  hide_timestamps?: boolean;
  hide_date_headers?: boolean;
  grid_options?: GridOptions;
}

// ── Discovery result types ────────────────────────────────────────────────────

export interface HubInfo {
  pubkey: string;
  name: string;
  nodeCountEntity: string;
}

export interface NodeInfo {
  name: string;
  deviceId: string;
  hubPubkey: string | null;
  ePrefix: string;
  eSuffix: string;
}

// ── Render helper types ───────────────────────────────────────────────────────

export interface TrafficCell {
  label: string;
  id: string | null;
  cls: string;
}

export interface TelemetryCell {
  label: string;
  id: string | null;
  unit: string;
}

// ── ha-form element types ─────────────────────────────────────────────────────

export interface HaFormSelector {
  boolean?: Record<string, never>;
  text?: Record<string, never>;
  icon?: Record<string, never>;
  ui_color?: { include_none?: boolean; default_color?: string };
  ui_action?: { default_action?: string };
  select?: {
    mode?: "dropdown" | "list";
    options: { value: string; label: string }[];
  };
  number?: {
    min?: number;
    max?: number;
    step?: number;
    mode?: "box" | "slider";
  };
  entity?: {
    domain?: string;
    include_entities?: string[];
  };
}

export interface HaFormFieldSchema {
  name: string;
  label?: string;
  selector: HaFormSelector;
}

export interface HaFormExpandableSchema {
  type: "expandable";
  name: string;
  title: string;
  icon?: string;
  flatten?: boolean;
  expanded?: boolean;
  schema: HaFormFieldSchema[];
}

export type HaFormSchema = HaFormFieldSchema | HaFormExpandableSchema;

export interface HaFormElement extends HTMLElement {
  hass: HomeAssistant;
  schema: HaFormSchema[];
  data: Record<string, unknown>;
  computeLabel: (schema: HaFormSchema) => string;
}

export interface HaAlertElement extends HTMLElement {
  alertType: "info" | "warning" | "error" | "success";
}

// ── Window augmentation ───────────────────────────────────────────────────────

export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards: CustomCardEntry[];
  }
}
