import { discoverHubs, discoverNodes } from "./discovery.js";
import {
  findScopedEntity,
  isUnavailableState,
  normalizeConnectivityState,
  type ExplicitConnectivityState,
} from "./entity-resolver.js";
import type {
  HassEntityRegistryEntry,
  HomeAssistant,
  HubInfo,
  MeshcoreStatusConfigBase,
  NodeInfo,
} from "./types.js";

export const DEFAULT_LOW_BATTERY_THRESHOLD = 50;

export type StatusSeverity = "healthy" | "warning" | "critical" | "unknown";
export type StatusConnectivityState = ExplicitConnectivityState;
export type StatusSubjectType = "hub" | "node" | "mqtt";

export type StatusFindingKind =
  | "hub_offline"
  | "node_offline"
  | "mqtt_disconnected"
  | "low_battery"
  | "radio_fault";

export type StatusUnknownKind =
  | "hub_status"
  | "node_status"
  | "mqtt_status"
  | "battery_status"
  | "radio_status";

export type StatusRadioFaultCode =
  | "err_pool_full"
  | "err_cad_timeout"
  | "err_rx_timeout";

export type StatusDiagnosticMetric =
  | "tx_queue_len"
  | "request_failures"
  | "full_evts"
  | "recv_errors"
  | "recv_errors_rate";

export interface StatusSubject {
  type: StatusSubjectType;
  id: string;
  name: string;
  deviceId: string | null;
}

export interface StatusFinding {
  id: string;
  kind: StatusFindingKind;
  severity: "critical" | "warning";
  subject: StatusSubject;
  entityId: string | null;
  value?: number | string;
  threshold?: number;
  radioCode?: StatusRadioFaultCode;
}

export interface StatusUnknownCheck {
  id: string;
  kind: StatusUnknownKind;
  subject: StatusSubject;
  entityId: string | null;
  radioCode?: StatusRadioFaultCode;
}

export interface StatusFindingGroup {
  id: StatusFindingKind;
  kind: StatusFindingKind;
  severity: "critical" | "warning";
  items: StatusFinding[];
}

export interface StatusUnknownGroup {
  id: StatusUnknownKind;
  kind: StatusUnknownKind;
  items: StatusUnknownCheck[];
}

export interface StatusNode {
  id: string;
  name: string;
  deviceId: string;
  state: StatusConnectivityState;
  entityId: string | null;
  batteryPercent: number | null;
  batteryEntityId: string | null;
  lastSuccessfulRequest: string | number | null;
}

export interface StatusMqttConnection {
  id: string;
  name: string;
  state: StatusConnectivityState;
  entityId: string;
}

export interface StatusDiagnostic {
  id: string;
  subject: StatusSubject;
  metric: StatusDiagnosticMetric;
  entityId: string;
  value: string;
  unit: string;
}

export interface StatusHub {
  pubkey: string;
  name: string;
  deviceId: string | null;
  state: StatusConnectivityState;
  entityId: string | null;
  primaryEntityId: string;
  batteryPercent: number | null;
  batteryEntityId: string | null;
}

export interface StatusSnapshot {
  generatedAt: number;
  hub: StatusHub;
  severity: StatusSeverity;
  issueCount: number;
  unknownCount: number;
  monitoredCount: number;
  onlineCount: number;
  offlineCount: number;
  nodeUnknownCount: number;
  nodes: {
    total: number;
    online: number;
    offline: number;
    unknown: number;
    items: StatusNode[];
  };
  mqtt: {
    total: number;
    connected: number;
    disconnected: number;
    unknown: number;
    items: StatusMqttConnection[];
  };
  findings: StatusFinding[];
  unknownChecks: StatusUnknownCheck[];
  groups: StatusFindingGroup[];
  unknownGroups: StatusUnknownGroup[];
  diagnostics: StatusDiagnostic[];
  lowBatteryThreshold: number;
  dependentChecksSuppressed: boolean;
}

export interface StatusBuildOptions {
  lowBatteryThreshold?: number;
  excludedNodes?: readonly string[];
  statusEntity?: string;
  batteryEntity?: string;
  now?: number;
}

const FINDING_ORDER: readonly StatusFindingKind[] = [
  "hub_offline",
  "node_offline",
  "mqtt_disconnected",
  "low_battery",
  "radio_fault",
];

const UNKNOWN_ORDER: readonly StatusUnknownKind[] = [
  "hub_status",
  "node_status",
  "mqtt_status",
  "battery_status",
  "radio_status",
];

const RADIO_FAULTS: readonly StatusRadioFaultCode[] = [
  "err_pool_full",
  "err_cad_timeout",
  "err_rx_timeout",
];

const DIAGNOSTIC_METRICS: readonly {
  metric: StatusDiagnosticMetric;
  aliases: readonly string[];
}[] = [
  { metric: "tx_queue_len", aliases: ["tx_queue_len", "queue_length"] },
  { metric: "request_failures", aliases: ["request_failures"] },
  { metric: "full_evts", aliases: ["full_evts"] },
  { metric: "recv_errors", aliases: ["recv_errors"] },
  { metric: "recv_errors_rate", aliases: ["recv_errors_rate"] },
];

function normalizedThreshold(value: unknown): number {
  let parsed: number;
  try {
    parsed = typeof value === "number" ? value : Number(value);
  } catch {
    return DEFAULT_LOW_BATTERY_THRESHOLD;
  }
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : DEFAULT_LOW_BATTERY_THRESHOLD;
}

function normalizedName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function optionalEntityId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function statusHubName(hass: HomeAssistant, hub: HubInfo): string {
  const device = hub.deviceId ? hass.devices?.[hub.deviceId] : undefined;
  const source = String(
    device?.name_by_user || device?.name || hub.name || hub.pubkey
  )
    .replace(/_/g, " ")
    .trim();
  return source.replace(/^MeshCore\s*/i, "").trim() || hub.pubkey;
}

function subjectSort<T extends { id: string; subject: StatusSubject }>(a: T, b: T): number {
  return a.subject.name.localeCompare(b.subject.name) || a.id.localeCompare(b.id);
}

function hubSubject(hub: HubInfo): StatusSubject {
  return {
    type: "hub",
    id: hub.pubkey,
    name: hub.name,
    deviceId: hub.deviceId,
  };
}

function nodeSubject(node: NodeInfo): StatusSubject {
  return {
    type: "node",
    id: node.deviceId,
    name: node.name,
    deviceId: node.deviceId,
  };
}

function entitySubject(
  hub: HubInfo,
  entityId: string,
  name: string
): StatusSubject {
  return {
    type: "mqtt",
    id: entityId,
    name,
    deviceId: hub.deviceId,
  };
}

function enabledMeshcoreEntry(entry: HassEntityRegistryEntry | undefined): boolean {
  return !!entry && entry.platform === "meshcore" && entry.disabled_by == null;
}

function hubDeviceEntities(
  hass: HomeAssistant,
  hub: HubInfo
): Array<[string, HassEntityRegistryEntry]> {
  if (!hub.deviceId) return [];
  return Object.entries(hass.entities ?? {}).filter(
    ([, entry]) => entry.device_id === hub.deviceId && enabledMeshcoreEntry(entry)
  );
}

function findHubMetric(
  hass: HomeAssistant,
  hub: HubInfo,
  metric: string,
  domain?: string
): string | null {
  const prefix = `${domain ?? "sensor"}.meshcore_${hub.pubkey}_${metric}`;
  const candidates = hubDeviceEntities(hass, hub)
    .map(([entityId]) => entityId)
    .filter((entityId) => !domain || entityId.startsWith(`${domain}.`));
  const exact = candidates.find((entityId) => entityId === prefix);
  if (exact) return exact;
  const scoped = candidates.find((entityId) => entityId.startsWith(`${prefix}_`));
  if (scoped) return scoped;
  // Once discovery has established a registry device boundary, it is
  // authoritative. Falling back to similarly prefixed global state can bind
  // a disabled entity or the same companion prefix from another config entry.
  if (hub.deviceId) return null;

  const fallback = [
    ...(hass.states[prefix] ? [prefix] : []),
    ...Object.keys(hass.states).filter((entityId) =>
      entityId.startsWith(`${prefix}_`)
    ),
  ];
  return (
    fallback.find((entityId) => {
      const entry = hass.entities?.[entityId];
      return (
        !entry ||
        (entry.device_id == null && enabledMeshcoreEntry(entry))
      );
    }) ?? null
  );
}

function percentageReading(
  hass: HomeAssistant,
  entityId: string | null
): { state: "absent" | "unknown" | "known"; value: number | null } {
  if (!entityId) return { state: "absent", value: null };
  const entity = hass.states[entityId];
  if (!entity || isUnavailableState(entity.state)) {
    return { state: "unknown", value: null };
  }
  const unit = String(entity.attributes["unit_of_measurement"] ?? "").trim();
  // Entity selection already distinguishes percentage telemetry from a
  // voltage-only generic battery. A selected percentage/override entity with
  // an incompatible unit is supported but unreadable, so surface it as
  // unknown rather than silently dropping the check.
  if (unit && unit !== "%") return { state: "unknown", value: null };
  const value = Number(entity.state);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { state: "unknown", value: null };
  }
  return { state: "known", value };
}

function findNodeMetric(
  hass: HomeAssistant,
  node: NodeInfo,
  metric: string,
  domain?: string
): string | null {
  return findScopedEntity(
    hass,
    node.deviceId,
    metric,
    node.ePrefix,
    node.eSuffix,
    { domain, enabledOnly: true, platform: "meshcore" }
  );
}

function resolveNodeState(
  hass: HomeAssistant,
  node: NodeInfo
): { state: StatusConnectivityState; entityId: string | null } {
  const binary = findNodeMetric(hass, node, "online", "binary_sensor");
  if (binary) {
    return {
      state: normalizeConnectivityState(hass.states[binary]?.state),
      entityId: binary,
    };
  }
  const legacyOnline = findNodeMetric(hass, node, "online", "sensor");
  const legacyStatus = legacyOnline ?? findNodeMetric(hass, node, "status", "sensor");
  return {
    state: normalizeConnectivityState(
      legacyStatus ? hass.states[legacyStatus]?.state : undefined
    ),
    entityId: legacyStatus,
  };
}

function resolveNodeBatteryEntity(hass: HomeAssistant, node: NodeInfo): string | null {
  const canonical =
    findNodeMetric(hass, node, "battery_percentage") ??
    findNodeMetric(hass, node, "battery_level");
  if (canonical) return canonical;
  const generic = findNodeMetric(hass, node, "battery");
  if (!generic) return null;
  return String(
    hass.states[generic]?.attributes["unit_of_measurement"] ?? ""
  ).trim() === "%"
    ? generic
    : null;
}

function mqttName(hass: HomeAssistant, entityId: string, index: number): string {
  const attributes = hass.states[entityId]?.attributes ?? {};
  const explicit =
    attributes["server"] ??
    attributes["broker"] ??
    attributes["host"] ??
    attributes["friendly_name"];
  return explicit ? String(explicit) : `MQTT ${index + 1}`;
}

function discoverMqttConnections(
  hass: HomeAssistant,
  hub: HubInfo
): StatusMqttConnection[] {
  const deviceEntries = hubDeviceEntities(hass, hub);
  const entityIds = deviceEntries
    .map(([entityId]) => entityId)
    .filter(
      (entityId) =>
        entityId.startsWith("binary_sensor.") &&
        /_mqtt_broker_\d+_connection(?:_|$)/.test(entityId)
    )
    .sort();
  return entityIds.map((entityId, index) => ({
    id: entityId,
    name: mqttName(hass, entityId, index),
    state: normalizeConnectivityState(hass.states[entityId]?.state),
    entityId,
  }));
}

function hasFiniteDiagnosticState(
  hass: HomeAssistant,
  entityId: string | null
): entityId is string {
  if (!entityId) return false;
  const state = hass.states[entityId];
  return (
    !!state &&
    !isUnavailableState(state.state) &&
    Number.isFinite(Number(state.state))
  );
}

function groupFindings(findings: StatusFinding[]): StatusFindingGroup[] {
  return FINDING_ORDER.flatMap((kind) => {
    const items = findings.filter((finding) => finding.kind === kind);
    if (!items.length) return [];
    return [{ id: kind, kind, severity: items[0].severity, items }];
  });
}

function groupUnknowns(checks: StatusUnknownCheck[]): StatusUnknownGroup[] {
  return UNKNOWN_ORDER.flatMap((kind) => {
    const items = checks.filter((check) => check.kind === kind);
    return items.length ? [{ id: kind, kind, items }] : [];
  });
}

/** Build the single source of truth consumed by both Status surfaces. */
export function buildStatusSnapshot(
  hass: HomeAssistant,
  hubPubkey: string,
  options: StatusBuildOptions = {}
): StatusSnapshot | null {
  const discoveredHub = discoverHubs(hass).find(
    (candidate) => candidate.pubkey === hubPubkey
  );
  if (!discoveredHub) return null;
  const hub: HubInfo = {
    ...discoveredHub,
    name: statusHubName(hass, discoveredHub),
  };

  const threshold = normalizedThreshold(options.lowBatteryThreshold);
  const excluded = new Set(
    (Array.isArray(options.excludedNodes) ? options.excludedNodes : [])
      .filter((name): name is string => typeof name === "string")
      .map(normalizedName)
      .filter(Boolean)
  );
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const statusEntity =
    optionalEntityId(options.statusEntity) ?? findHubMetric(hass, hub, "node_status");
  const hubState = normalizeConnectivityState(
    statusEntity ? hass.states[statusEntity]?.state : undefined
  );
  const primaryEntityId = statusEntity ?? hub.nodeCountEntity;
  const findings: StatusFinding[] = [];
  const unknownChecks: StatusUnknownCheck[] = [];
  const hubInfoSubject = hubSubject(hub);

  let hubBatteryEntity: string | null = null;
  let hubBatteryPercent: number | null = null;
  let nodes: StatusNode[] = [];
  let mqtt: StatusMqttConnection[] = [];
  let diagnostics: StatusDiagnostic[] = [];

  if (hubState === "offline") {
    findings.push({
      id: `hub:${hub.pubkey}:offline`,
      kind: "hub_offline",
      severity: "critical",
      subject: hubInfoSubject,
      entityId: statusEntity,
    });
  } else if (hubState === "unknown") {
    unknownChecks.push({
      id: `hub:${hub.pubkey}:status`,
      kind: "hub_status",
      subject: hubInfoSubject,
      entityId: statusEntity,
    });
  } else {
    const discoveredNodes = discoverNodes(hass)
      .filter(
        (node) =>
          node.hubPubkey === hub.pubkey && !excluded.has(normalizedName(node.name))
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId));

    nodes = discoveredNodes.map((node) => {
      const connectivity = resolveNodeState(hass, node);
      const batteryEntity =
        connectivity.state === "online" ? resolveNodeBatteryEntity(hass, node) : null;
      const battery = percentageReading(hass, batteryEntity);
      const subject = nodeSubject(node);
      const lastSuccessfulRequest = connectivity.entityId
        ? hass.states[connectivity.entityId]?.attributes["last_successful_request"] ?? null
        : null;

      if (connectivity.state === "offline") {
        findings.push({
          id: `node:${node.deviceId}:offline`,
          kind: "node_offline",
          severity: "warning",
          subject,
          entityId: connectivity.entityId,
        });
      } else if (connectivity.state === "unknown") {
        unknownChecks.push({
          id: `node:${node.deviceId}:status`,
          kind: "node_status",
          subject,
          entityId: connectivity.entityId,
        });
      } else if (battery.state === "unknown") {
        unknownChecks.push({
          id: `node:${node.deviceId}:battery`,
          kind: "battery_status",
          subject,
          entityId: batteryEntity,
        });
      } else if (battery.state === "known" && battery.value! < threshold) {
        findings.push({
          id: `node:${node.deviceId}:battery`,
          kind: "low_battery",
          severity: "warning",
          subject,
          entityId: batteryEntity,
          value: battery.value!,
          threshold,
        });
      }

      return {
        id: node.deviceId,
        name: node.name,
        deviceId: node.deviceId,
        state: connectivity.state,
        entityId: connectivity.entityId,
        batteryPercent: battery.state === "known" ? battery.value : null,
        batteryEntityId: batteryEntity,
        lastSuccessfulRequest:
          typeof lastSuccessfulRequest === "string" ||
          typeof lastSuccessfulRequest === "number"
            ? lastSuccessfulRequest
            : null,
      };
    });

    hubBatteryEntity =
      optionalEntityId(options.batteryEntity) ??
      findHubMetric(hass, hub, "battery_percentage");
    const hubBattery = percentageReading(hass, hubBatteryEntity);
    // Preserve the established convention that a hub reporting 0% has no
    // meaningful battery telemetry (normally a mains-powered companion).
    if (hubBattery.state === "known" && hubBattery.value !== 0) {
      hubBatteryPercent = hubBattery.value;
      if (hubBattery.value! < threshold) {
        findings.push({
          id: `hub:${hub.pubkey}:battery`,
          kind: "low_battery",
          severity: "warning",
          subject: hubInfoSubject,
          entityId: hubBatteryEntity,
          value: hubBattery.value!,
          threshold,
        });
      }
    } else if (hubBattery.state === "unknown") {
      unknownChecks.push({
        id: `hub:${hub.pubkey}:battery`,
        kind: "battery_status",
        subject: hubInfoSubject,
        entityId: hubBatteryEntity,
      });
    }

    mqtt = discoverMqttConnections(hass, hub);
    for (const connection of mqtt) {
      const subject = entitySubject(hub, connection.entityId, connection.name);
      if (connection.state === "offline") {
        findings.push({
          id: `mqtt:${connection.entityId}:offline`,
          kind: "mqtt_disconnected",
          severity: "warning",
          subject,
          entityId: connection.entityId,
        });
      } else if (connection.state === "unknown") {
        unknownChecks.push({
          id: `mqtt:${connection.entityId}:status`,
          kind: "mqtt_status",
          subject,
          entityId: connection.entityId,
        });
      }
    }

    for (const code of RADIO_FAULTS) {
      const entityId = findHubMetric(hass, hub, code, "binary_sensor");
      if (!entityId) continue;
      const state = normalizeConnectivityState(hass.states[entityId]?.state);
      if (state === "online") {
        findings.push({
          id: `hub:${hub.pubkey}:radio:${code}`,
          kind: "radio_fault",
          severity: "warning",
          subject: hubInfoSubject,
          entityId,
          radioCode: code,
        });
      } else if (state === "unknown") {
        unknownChecks.push({
          id: `hub:${hub.pubkey}:radio:${code}`,
          kind: "radio_status",
          subject: hubInfoSubject,
          entityId,
          radioCode: code,
        });
      }
    }

    for (const descriptor of DIAGNOSTIC_METRICS) {
      const entityId = descriptor.aliases
        .map((alias) => findHubMetric(hass, hub, alias))
        .find((candidate) => hasFiniteDiagnosticState(hass, candidate));
      if (!entityId) continue;
      const state = hass.states[entityId]!;
      diagnostics.push({
        id: `hub:${hub.pubkey}:${descriptor.metric}`,
        subject: hubInfoSubject,
        metric: descriptor.metric,
        entityId,
        value: state.state,
        unit: String(state.attributes["unit_of_measurement"] ?? ""),
      });
    }

    for (const node of discoveredNodes) {
      const renderedNode = nodes.find((candidate) => candidate.deviceId === node.deviceId);
      if (renderedNode?.state !== "online") continue;
      for (const descriptor of DIAGNOSTIC_METRICS) {
        const entityId = descriptor.aliases
          .map((alias) => findNodeMetric(hass, node, alias))
          .find((candidate) => hasFiniteDiagnosticState(hass, candidate));
        if (!entityId) continue;
        const state = hass.states[entityId];
        if (!state) continue;
        diagnostics.push({
          id: `${node.deviceId}:${descriptor.metric}`,
          subject: nodeSubject(node),
          metric: descriptor.metric,
          entityId,
          value: state.state,
          unit: String(state.attributes["unit_of_measurement"] ?? ""),
        });
      }
    }
  }

  findings.sort((a, b) => {
    const kind = FINDING_ORDER.indexOf(a.kind) - FINDING_ORDER.indexOf(b.kind);
    if (kind) return kind;
    if (a.kind === "radio_fault" && b.kind === "radio_fault") {
      const radio =
        RADIO_FAULTS.indexOf(a.radioCode!) - RADIO_FAULTS.indexOf(b.radioCode!);
      if (radio) return radio;
    }
    return subjectSort(a, b);
  });
  unknownChecks.sort((a, b) => {
    const kind = UNKNOWN_ORDER.indexOf(a.kind) - UNKNOWN_ORDER.indexOf(b.kind);
    return kind || subjectSort(a, b);
  });
  diagnostics.sort(
    (a, b) =>
      (a.subject.type === b.subject.type
        ? 0
        : a.subject.type === "hub"
          ? -1
          : 1) ||
      a.subject.name.localeCompare(b.subject.name) ||
      DIAGNOSTIC_METRICS.findIndex((entry) => entry.metric === a.metric) -
        DIAGNOSTIC_METRICS.findIndex((entry) => entry.metric === b.metric)
  );

  const online = nodes.filter((node) => node.state === "online").length;
  const offline = nodes.filter((node) => node.state === "offline").length;
  const nodeUnknown = nodes.filter((node) => node.state === "unknown").length;
  const severity: StatusSeverity =
    hubState === "offline"
      ? "critical"
      : hubState === "unknown"
        ? "unknown"
        : findings.length
          ? "warning"
          : unknownChecks.length
            ? "unknown"
            : "healthy";

  return {
    generatedAt: now,
    hub: {
      pubkey: hub.pubkey,
      name: hub.name,
      deviceId: hub.deviceId,
      state: hubState,
      entityId: statusEntity,
      primaryEntityId,
      batteryPercent: hubBatteryPercent,
      batteryEntityId: hubBatteryEntity,
    },
    severity,
    issueCount: findings.length,
    unknownCount: unknownChecks.length,
    monitoredCount: nodes.length,
    onlineCount: online,
    offlineCount: offline,
    nodeUnknownCount: nodeUnknown,
    nodes: {
      total: nodes.length,
      online,
      offline,
      unknown: nodeUnknown,
      items: nodes,
    },
    mqtt: {
      total: mqtt.length,
      connected: mqtt.filter((connection) => connection.state === "online").length,
      disconnected: mqtt.filter((connection) => connection.state === "offline").length,
      unknown: mqtt.filter((connection) => connection.state === "unknown").length,
      items: mqtt,
    },
    findings,
    unknownChecks,
    groups: groupFindings(findings),
    unknownGroups: groupUnknowns(unknownChecks),
    diagnostics,
    lowBatteryThreshold: threshold,
    dependentChecksSuppressed: hubState !== "online",
  };
}

export function statusOptionsFromConfig(
  config: MeshcoreStatusConfigBase | undefined,
  now?: number
): StatusBuildOptions {
  return {
    lowBatteryThreshold: config?.low_battery_threshold,
    excludedNodes: config?.excluded_nodes,
    statusEntity: config?.status_entity,
    batteryEntity: config?.battery_entity,
    now,
  };
}
