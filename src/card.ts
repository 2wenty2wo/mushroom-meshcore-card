import type {
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreChipId,
  HubInfo,
  NodeInfo,
} from "./types.js";
import {
  isOnlineState,
  formatLastSeen,
  batteryColor,
  formatUptime,
  escapeHtml,
  mapLinkUrl,
} from "./helpers.js";
import { handleAction, HeaderActionController } from "./actions.js";
import { STYLES } from "./styles.js";
import { discoverHubs, discoverNodes, findEntityByDevice } from "./discovery.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";
import { hydrateTileInfo, renderTileHeader } from "./tile-header.js";
import { effectiveChipLayout } from "./chip-layout.js";
import {
  type NeighborInfo,
  type NeighborSnapshot,
  renderNeighborSection,
} from "./neighbors.js";
import {
  NEIGHBORS_DIALOG_TAG,
  neighborsDialogImport,
  type NeighborsDialogParams,
} from "./neighbors-dialog.js";

interface EntityReading {
  id: string | null;
  value: string | null;
}

type NodeConnectivityState = "online" | "offline" | "unknown";

interface EntityLookupOptions {
  domain?: string;
  enabledOnly?: boolean;
  platform?: string;
}

interface NodeViewModel {
  node: NodeInfo;
  displayName: string;
  connectivity: NodeConnectivityState;
  isRepeater: boolean;
  isSensor: boolean;
  icon: string;
  firmwareVersion: string | null;
  primaryEntityId: string | null;
  lastSeen: string | null;
  rssi: EntityReading;
  snr: EntityReading;
  batteryPct: EntityReading;
  batteryVoltage: EntityReading;
  sent: EntityReading;
  received: EntityReading;
  temperature: EntityReading;
  humidity: EntityReading;
  illuminance: EntityReading;
  pressure: EntityReading;
  route: EntityReading;
  pathLength: EntityReading;
  uptime: EntityReading;
  relayed: EntityReading;
  canceled: EntityReading;
  duplicate: EntityReading;
  txAirtime: EntityReading;
  rxAirtime: EntityReading;
  noiseFloor: EntityReading;
  queueLength: EntityReading;
  txRate: EntityReading;
  rxRate: EntityReading;
  spreadingFactor: EntityReading;
  frequency: EntityReading;
  bandwidth: EntityReading;
  txPower: EntityReading;
  latitude: unknown;
  longitude: unknown;
  locationEntityId: string | null;
  neighbors: NeighborSnapshot;
}

export class MeshcoreCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreCardConfig;
  private _fp: string | null = null;
  private _lastRender = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _trimTimer: ReturnType<typeof requestAnimationFrame> | null = null;
  private _headerActions: HeaderActionController;
  private _openDetails = new Set<string>();
  private _detailsSeeded = false;
  private _cardSize = 1;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._headerActions = new HeaderActionController(
      this,
      () => this._hass,
      () => this._config,
      () => this._confirmText()
    );
    this.shadowRoot!.addEventListener("click", (e: Event) => {
      if (this._headerActions.handleClick(e)) return;
      const target = e.target as Element;
      if (target.closest("[data-neighbors-dialog]")) {
        this._showNeighborsDialog();
        return;
      }
      const el = target.closest("[data-entity]") as HTMLElement | null;
      if (el?.dataset["entity"]) {
        handleAction(this, this._hass, { action: "more-info" }, el.dataset["entity"]);
      }
    });
    this.shadowRoot!.addEventListener("pointerdown", (e: Event) => {
      this._headerActions.handlePointerDown(e);
    });
    for (const type of ["pointerup", "pointercancel"]) {
      this.shadowRoot!.addEventListener(type, () =>
        this._headerActions.handlePointerEnd()
      );
    }
    this.shadowRoot!.addEventListener("toggle", (e: Event) => {
      const details = e.target as HTMLDetailsElement;
      const deviceId = details.dataset?.["nodeId"];
      if (!deviceId || details.tagName !== "DETAILS") return;
      if (details.open) this._openDetails.add(deviceId);
      else this._openDetails.delete(deviceId);
      if (typeof this._config?.grid_options?.rows === "number") {
        this._scheduleTrim(".trim-section");
      }
    }, true);
  }

  connectedCallback(): void {
    // Relative timestamps ("5m ago", neighbor last-seen) go stale without
    // state changes; refresh them on a slow tick while the card is on screen.
    if (this._tickTimer === null) {
      this._tickTimer = setInterval(() => {
        if (this._hass && this._config) this._render();
      }, 60000);
    }
  }

  disconnectedCallback(): void {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    if (this._renderTimer !== null) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    if (this._trimTimer !== null) {
      cancelAnimationFrame(this._trimTimer);
      this._trimTimer = null;
    }
    this._headerActions.disconnect();
  }

  private _confirmText(): string {
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    return t("card.confirm_action");
  }

  setConfig(config: MeshcoreCardConfig): void {
    const previous = this._config;
    this._config = { ...config };
    if (
      previous?.target &&
      (previous.target.type !== config.target?.type || previous.target.id !== config.target?.id)
    ) {
      this._openDetails.clear();
      this._detailsSeeded = false;
    }
    if (previous?.details_default_open !== config.details_default_open) {
      this._detailsSeeded = false;
    }
    this._fp = null; // force re-render on config change
    this._render();
  }

  private _overrideEntityIds(): Set<string> {
    const c = this._config;
    const ids = [
      c?.battery_entity,
      c?.voltage_entity,
      c?.location_entity,
      c?.temperature_entity,
      c?.humidity_entity,
      c?.illuminance_entity,
      c?.pressure_entity,
    ].filter((id): id is string => !!id);
    return new Set(ids);
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const overrides = this._overrideEntityIds();
    const target = this._config?.target;
    const targetDevices = target?.type === "node"
      ? Object.values(hass.devices).filter(
          (device) =>
            (device.name_by_user || device.name || device.id) === target.id
        )
      : [];
    const deviceFp = targetDevices
      .map((device) => JSON.stringify([device.id, device.sw_version ?? null]))
      .sort()
      .join("|");
    const targetDeviceIds = new Set(targetDevices.map((device) => device.id));
    const onlineRegistryFp = Object.entries(hass.entities)
      .filter(
        ([entityId, info]) =>
          entityId.startsWith("binary_sensor.") &&
          info.platform === "meshcore" &&
          !!info.device_id &&
          targetDeviceIds.has(info.device_id) &&
          /_online(?:_|$)/.test(entityId)
      )
      .map(([entityId, info]) => `${entityId}:${info.disabled_by ?? "enabled"}`)
      .sort()
      .join("|");
    const stateFp = Object.entries(hass.states)
      .filter(([id]) => id.includes("meshcore") || overrides.has(id))
      .map(([id, s]) => `${id}=${s.state}@${s.last_changed}`)
      .join("|");
    const fp = `${stateFp}|device=${deviceFp}|online-registry=${onlineRegistryFp}`;
    if (fp === this._fp) return;
    this._fp = fp;
    const now = Date.now();
    if (now - this._lastRender >= 10000) {
      this._lastRender = now;
      this._render();
    } else if (!this._renderTimer) {
      const delay = 10000 - (now - this._lastRender);
      this._renderTimer = setTimeout(() => {
        this._renderTimer = null;
        this._lastRender = Date.now();
        this._render();
      }, delay);
    }
  }

  // ── Entity accessors ───────────────────────────────────────────────────────

  private _val(id: string | null): string | null {
    if (!id) return null;
    const s = this._hass?.states[id];
    return s ? s.state : null;
  }

  private _attr(id: string | null, attr: string): unknown {
    if (!id) return null;
    return this._hass?.states[id]?.attributes[attr] ?? null;
  }

  private _exists(id: string | null | undefined): boolean {
    return !!id && !!this._hass?.states[id];
  }

  private _find(prefix: string): string | null {
    if (!this._hass) return null;
    if (this._hass.states[prefix]) return prefix;
    for (const id of Object.keys(this._hass.states)) {
      if (id.startsWith(prefix + "_")) return id;
    }
    return null;
  }

  private _findEntityByDevice(
    deviceId: string,
    metric: string,
    ePrefix: string,
    eSuffix: string,
    options?: EntityLookupOptions
  ): string | null {
    if (!this._hass?.entities) return null;
    const entities = options
      ? Object.fromEntries(
          Object.entries(this._hass.entities).filter(([entityId, info]) => {
            if (options.domain && !entityId.startsWith(`${options.domain}.`)) {
              return false;
            }
            if (options.platform && info.platform !== options.platform) {
              return false;
            }
            return !options.enabledOnly || info.disabled_by == null;
          })
        )
      : this._hass.entities;
    return findEntityByDevice(entities, deviceId, metric, ePrefix, eSuffix);
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  private _discoverHubs(): HubInfo[] {
    if (!this._hass) return [];
    return discoverHubs(this._hass);
  }

  private _discoverNodes(): NodeInfo[] {
    if (!this._hass) return [];
    return discoverNodes(this._hass);
  }

  private _hubEntity(pubkey: string, hubName: string, metric: string): string | null {
    if (!this._hass) return null;
    const exact = `sensor.meshcore_${pubkey}_${metric}_${hubName}`;
    if (this._hass.states[exact]) return exact;
    return this._find(`sensor.meshcore_${pubkey}_${metric}`);
  }

  /** Find the contact binary_sensor for a node (matched by adv_name attribute). */
  private _contactEntity(nodeName: string): string | null {
    if (!this._hass) return null;
    for (const [id, state] of Object.entries(this._hass.states)) {
      if (!/^binary_sensor\.meshcore_.*_contact$/.test(id)) continue;
      if (String(state.attributes["adv_name"] ?? "") === nodeName) return id;
    }
    return null;
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  private _renderDeviceHeader(
    displayName: string,
    secondary: string,
    icon: string,
    online: boolean,
    primaryEntityId: string | null,
    trailing = "",
    inactiveState: "offline" | "unknown" = "offline",
    inactiveBadgeIcon?: string
  ): string {
    return renderTileHeader(this._config, {
      displayName,
      secondary,
      icon,
      active: online,
      primaryEntityId,
      trailing,
      inactiveState,
      inactiveBadgeIcon,
    });
  }

  private _reading(id: string | null, numeric = false): EntityReading {
    const value = this._val(id);
    if (value === null) return { id, value: null };
    const normalized = value.trim().toLowerCase();
    if (!normalized || ["unknown", "unavailable", "none", "null"].includes(normalized)) {
      return { id, value: null };
    }
    if (numeric && !Number.isFinite(Number(value))) return { id, value: null };
    return { id, value };
  }

  private _firmwareVersion(deviceId: string): string | null {
    const value = this._hass?.devices[deviceId]?.sw_version;
    if (typeof value !== "string") return null;
    const normalized = value.trim().replace(/\s+/g, " ");
    if (
      !normalized ||
      ["unknown", "unavailable", "none", "null"].includes(normalized.toLowerCase())
    ) {
      return null;
    }
    return normalized;
  }

  private _progressBar(
    pct: string | number | null,
    color: string,
    label: string
  ): string {
    const w = Math.min(100, Math.max(0, Number(pct) || 0));
    return `<div class="bar-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w}"><div class="bar-fill" style="width:${w}%;--bar-color:${color}"></div></div>`;
  }

  private _chip(
    id: string | null,
    label: string,
    value: string | null,
    cls = ""
  ): string {
    if (!id || value === null) return "";
    const blank = value === "unknown" || value === "unavailable";
    const ariaLabel = `${label}${label ? " " : ""}${blank ? "—" : value}`;
    return `<button type="button" class="chip ${cls} clickable" data-entity="${escapeHtml(id)}" aria-label="${escapeHtml(ariaLabel)}"><ha-ripple></ha-ripple>${
      label ? `<span class="chip-label">${escapeHtml(label)}</span>` : ""
    }${blank ? "—" : escapeHtml(value)}</button>`;
  }

  private _metric(reading: EntityReading, label: string, unit: string): string {
    if (!reading.id || reading.value === null) return "";
    const ariaLabel = `${label} ${reading.value}${unit ? ` ${unit}` : ""}`;
    return `<button type="button" class="node-metric clickable" part="metric" data-entity="${escapeHtml(reading.id)}" aria-label="${escapeHtml(ariaLabel)}">
      <ha-ripple></ha-ripple>
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(reading.value)}${unit ? `<span class="metric-unit"> ${escapeHtml(unit)}</span>` : ""}</span>
    </button>`;
  }

  private _quickChip(
    reading: EntityReading,
    label: string,
    unit: string,
    icon: string
  ): string {
    if (!reading.id || reading.value === null) return "";
    const ariaLabel = `${label} ${reading.value}${unit ? ` ${unit}` : ""}`;
    return `<button type="button" class="quick-chip clickable" part="quick-chip" data-entity="${escapeHtml(reading.id)}" aria-label="${escapeHtml(ariaLabel)}">
      <ha-ripple></ha-ripple>
      <ha-icon icon="${escapeHtml(icon)}"></ha-icon>
      <span>${escapeHtml(reading.value)}${unit ? ` ${escapeHtml(unit)}` : ""}</span>
    </button>`;
  }

  private _locLink(lat: unknown, lon: unknown, entityId: string | null, t: LocalizeFunc): string {
    if (!entityId) return "";
    const latF = parseFloat(String(lat)).toFixed(5);
    const lonF = parseFloat(String(lon)).toFixed(5);
    const url = mapLinkUrl(this._config ?? {}, lat, lon);
    return `<div class="loc-row">
      <button type="button" class="loc-coords clickable" data-entity="${escapeHtml(entityId)}" aria-label="${escapeHtml(t("card.location_section"))} ${latF}, ${lonF}"><ha-icon icon="mdi:map-marker"></ha-icon>${latF}, ${lonF}</button>
      <a class="map-link" href="${url}" target="_blank" rel="noopener">${escapeHtml(t("card.map_link"))}</a>
    </div>`;
  }

  // ── Neighbors helpers ──────────────────────────────────────────────────────

  private _getNeighbors(deviceId: string): NeighborSnapshot {
    if (!this._hass || !deviceId) {
      return { supported: false, countEntityId: null, neighbors: [] };
    }

    const neighborMap = new Map<string, {
      snr?: number;
      snrId?: string;
      seenCount?: number;
      seenId?: string;
      secondsAgo?: number;
      resolvedName?: string;
    }>();
    let supported = false;
    let countEntityId: string | null = null;

    for (const [entityId, info] of Object.entries(this._hass.entities || {})) {
      if (info.device_id !== deviceId) continue;

      if (/_neighbor_count$/.test(entityId)) {
        const count = this._reading(entityId, true).value;
        if (count !== null) {
          supported = true;
          countEntityId = entityId;
        }
        continue;
      }

      const seenMatch = entityId.match(/_neighbor_([0-9a-f]+)_seen$/);
      if (seenMatch) {
        const data = neighborMap.get(seenMatch[1]) ?? {};
        neighborMap.set(seenMatch[1], data);
        const rawCount = this._val(entityId);
        const count = rawCount === null ? NaN : Number(rawCount);
        if (Number.isFinite(count)) {
          supported = true;
          data.seenCount = count;
          data.seenId = entityId;
        }
      }

      const neighborMatch = entityId.match(/_neighbor_([0-9a-f]+)$/);
      if (!neighborMatch || entityId.endsWith("_seen")) continue;
      const data = neighborMap.get(neighborMatch[1]) ?? {};
      neighborMap.set(neighborMatch[1], data);
      const state = this._hass.states[entityId];
      const rawSecondsAgo = state?.attributes["secs_ago"];
      const secondsAgo = typeof rawSecondsAgo === "number"
        ? rawSecondsAgo
        : typeof rawSecondsAgo === "string" && rawSecondsAgo.trim()
          ? Number(rawSecondsAgo)
          : NaN;
      if (Number.isFinite(secondsAgo) && secondsAgo >= 0) {
        supported = true;
        data.secondsAgo = secondsAgo;
      }
      const resolvedName = state?.attributes["resolved_name"];
      if (typeof resolvedName === "string" && resolvedName.trim()) {
        data.resolvedName = resolvedName.trim();
      }
      const rawSnr = this._val(entityId);
      const snr = rawSnr === null ? NaN : Number(rawSnr);
      if (Number.isFinite(snr)) {
        data.snr = snr;
        data.snrId = entityId;
      }
    }

    const neighbors: NeighborInfo[] = [];
    for (const [neighborId, data] of neighborMap) {
      const recent = data.secondsAgo !== undefined
        ? data.secondsAgo < 48 * 60 * 60
        : (data.seenCount ?? 0) > 0;
      if (!recent || data.snr === undefined || !data.snrId) continue;

      let neighborName = data.resolvedName ?? neighborId.substring(0, 8);
      let contactEntityId: string | null = null;
      for (const [entityId, state] of Object.entries(this._hass.states)) {
        if (!/^binary_sensor\.meshcore_.*_contact$/.test(entityId)) continue;
        const advId = state.attributes["adv_id"];
        if ((advId && String(advId) === neighborId) || entityId.includes(neighborId)) {
          if (!data.resolvedName) {
            neighborName = String(state.attributes["adv_name"] || neighborName);
          }
          contactEntityId = entityId;
          break;
        }
      }

      neighbors.push({
        id: neighborId,
        name: neighborName,
        contactEntityId,
        snr: data.snr,
        snrId: data.snrId,
        secondsAgo: data.secondsAgo ?? null,
        seenCount: data.seenCount ?? null,
        seenId: data.seenId ?? null,
      });
    }
    neighbors.sort((a, b) => b.snr - a.snr);
    return { supported, countEntityId, neighbors };
  }

  // ── Shared body primitives ─────────────────────────────────────────────────

  /** Node-card battery block, shared by hub and node bodies. */
  private _batteryBlock(
    pct: EntityReading,
    voltageReading: EntityReading,
    t: LocalizeFunc
  ): string {
    if (pct.value === null) return "";
    const voltage = voltageReading.value !== null
      ? Number(voltageReading.value).toFixed(2)
      : null;
    return `<div class="battery-block" part="battery">
          <div class="battery-meta">
            <span>${escapeHtml(t("card.battery_label"))}</span>
            <span class="battery-values">
              ${pct.id ? `<button type="button" class="battery-percentage clickable" data-entity="${escapeHtml(pct.id)}" aria-label="${escapeHtml(t("card.battery_label"))} ${escapeHtml(pct.value)}%">${escapeHtml(pct.value)}%</button>` : ""}
              ${voltage && voltageReading.id ? `<button type="button" class="battery-voltage clickable" data-entity="${escapeHtml(voltageReading.id)}" aria-label="${escapeHtml(t("card.battery_voltage"))} ${voltage} V">${voltage} V</button>` : ""}
            </span>
          </div>
          ${this._progressBar(pct.value, batteryColor(pct.value), t("card.battery_label"))}
        </div>`;
  }

  /** Quick-chip-styled static fact (no backing entity, not clickable). */
  private _staticChip(value: unknown, icon: string, ariaLabel?: string): string {
    if (!value) return "";
    const accessible = ariaLabel
      ? ` role="note" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(ariaLabel)}"`
      : "";
    return `<span class="quick-chip static-chip" part="quick-chip"${accessible}>
      <ha-icon icon="${escapeHtml(icon)}"></ha-icon>
      <span class="static-chip-content">${escapeHtml(value)}</span>
    </span>`;
  }

  private _staticDetailChip(value: unknown, label: string): string {
    if (value === null || value === undefined || value === "") return "";
    return `<span class="chip static-chip" role="note" aria-label="${escapeHtml(`${label} ${String(value)}`)}"><span class="chip-label">${escapeHtml(label)} </span>${escapeHtml(value)}</span>`;
  }

  private _neighborCountChip(
    snapshot: NeighborSnapshot,
    t: LocalizeFunc,
    details: boolean
  ): string {
    if (this._config?.show_neighbors === false || !snapshot.supported) return "";
    const count = snapshot.neighbors.length;
    const label = t(count === 1 ? "card.neighbor_48h_one" : "card.neighbors_48h", { n: count });
    if (details) {
      return `<button type="button" class="chip clickable" data-neighbors-dialog aria-haspopup="dialog" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><ha-ripple></ha-ripple><span class="chip-label">${escapeHtml(t("card.neighbors_label"))} </span>${escapeHtml(count)}</button>`;
    }
    return `<button type="button" class="quick-chip clickable" part="quick-chip" data-neighbors-dialog aria-haspopup="dialog" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><ha-ripple></ha-ripple><ha-icon icon="mdi:access-point-network"></ha-icon><span>${escapeHtml(count)}</span></button>`;
  }

  private _showNeighborsDialog(): void {
    if (!this._hass || this._config?.show_neighbors === false) return;
    const target = this._config?.target;
    if (target?.type !== "node") return;
    const node = this._discoverNodes().find((item) => item.name === target.id);
    if (!node) return;

    const t = makeLocalize(this._hass.language ?? this._hass.locale?.language ?? "en");
    const vm = this._buildNodeViewModel(node, t);
    if (!vm.neighbors.supported) return;

    const dialogParams: NeighborsDialogParams = {
      title: this._config?.name || vm.displayName,
      snapshot: vm.neighbors,
      maxNeighbors: this._config?.max_neighbors,
      localize: t,
      closeLabel: this._hass.localize?.("ui.common.close") ?? "Close",
    };
    this.dispatchEvent(new CustomEvent("show-dialog", {
      bubbles: true,
      composed: true,
      detail: {
        dialogTag: NEIGHBORS_DIALOG_TAG,
        dialogImport: neighborsDialogImport,
        dialogParams,
      },
    }));
  }

  /** Collapsed Details disclosure shared by hub and node bodies. */
  private _renderDetailsDisclosure(key: string, body: string, t: LocalizeFunc): string {
    if (!body || this._config?.hide_details) return "";
    const open = this._openDetails.has(key) ? " open" : "";
    return `<details class="node-details" part="details" data-node-id="${escapeHtml(key)}"${open}>
      <summary class="clickable"><ha-ripple></ha-ripple><span>${escapeHtml(t("card.details"))}</span><ha-icon icon="mdi:chevron-down"></ha-icon></summary>
      <div class="details-content trim-section">${body}</div>
    </details>`;
  }

  private _seedDetails(key: string): void {
    if (this._config?.details_default_open && !this._detailsSeeded) {
      this._detailsSeeded = true;
      this._openDetails.add(key);
    }
  }

  // ── Hub rendering ──────────────────────────────────────────────────────────

  private _renderHub(hub: HubInfo, t: LocalizeFunc): string {
    const { pubkey, name } = hub;
    const e = (m: string) => this._hubEntity(pubkey, name, m);
    const cfg = this._config;

    const statusId  = e("node_status");
    const countId   = hub.nodeCountEntity;
    const battPctId = cfg?.battery_entity ?? e("battery_percentage");
    const battVId   = cfg?.voltage_entity  ?? e("battery_voltage");
    const freqId    = e("frequency");
    const bwId      = e("bandwidth");
    const sfId      = e("spreading_factor");
    const txPowId   = e("tx_power");
    const latId     = e("latitude");
    const lonId     = e("longitude");
    const rateLimId = e("request_rate_limiter");
    const ch1VId    = e("ch1_voltage");

    const mqttIds = Object.keys(this._hass?.states ?? {})
      .filter((id) => /meshcore_[a-f0-9]+_mqtt/.test(id) && id.includes(pubkey))
      .sort();

    const status    = this._val(statusId) ?? "unknown";
    const battPct   = this._reading(battPctId, true);
    const battV     = this._reading(battVId, true);
    const nodeCount = this._reading(countId, true).value;
    const freqReading = this._reading(freqId, true);
    const bwReading = this._reading(bwId, true);
    const sfReading = this._reading(sfId, true);
    const txPowReading = this._reading(txPowId, true);
    const ch1VReading = this._reading(ch1VId, true);
    const rateLimReading = this._reading(rateLimId, true);
    const lat       = this._reading(latId, true).value;
    const lon       = this._reading(lonId, true).value;

    // Preserve the long-standing "no battery on mains-powered hubs" behavior.
    if (battPct.value !== null && Number(battPct.value) === 0) battPct.value = null;
    if (battV.value !== null && parseFloat(battV.value) < 0.001) battV.value = null;

    const hwModel  = this._attr(statusId, "hw_model") || this._attr(countId, "hw_model");
    const firmware = this._attr(statusId, "firmware_version") || this._attr(countId, "firmware_version");

    const online = isOnlineState(status);

    // Clean hub name (remove MeshCore if present)
    let displayName = name.replace(/_/g, " ");
    const meshcorePattern = /^MeshCore\s+/i;
    if (meshcorePattern.test(displayName)) {
      displayName = displayName.replace(meshcorePattern, "");
    } else if (displayName.toLowerCase().startsWith("meshcore")) {
      displayName = displayName.substring(8);
    }

    const secondary = `${online ? t("card.online") : t("card.offline")} · ${pubkey}`;
    const nodeCountChip = nodeCount !== null
      ? `<button type="button" class="count-badge clickable" data-entity="${escapeHtml(countId)}" aria-label="${escapeHtml(t("card.nodes_count", { n: nodeCount }))}"><ha-ripple></ha-ripple>${escapeHtml(t("card.nodes_count", { n: nodeCount }))}</button>`
      : "";
    const header = this._renderDeviceHeader(
      displayName.trim(),
      secondary,
      "mdi:router-wireless",
      online,
      statusId ?? countId,
      nodeCountChip
    );

    const battery = cfg?.hide_battery ? "" : this._batteryBlock(battPct, battV, t);
    if (freqReading.value !== null) {
      freqReading.value = Number(freqReading.value).toFixed(3);
    }

    const renderHubChip = (id: MeshcoreChipId, details: boolean): string => {
      if (id === "hardware") {
        return details
          ? this._staticDetailChip(hwModel, t("card.hardware"))
          : this._staticChip(hwModel, "mdi:chip");
      }
      if (id === "firmware") {
        return details
          ? this._staticDetailChip(firmware, t("card.firmware"))
          : this._staticChip(firmware, "mdi:memory", firmware
            ? t("card.firmware_label", { version: String(firmware) })
            : undefined);
      }
      const descriptors: Partial<Record<MeshcoreChipId, [EntityReading, string, string, string]>> = {
        frequency: [freqReading, t("card.frequency"), " MHz", "mdi:sine-wave"],
        bandwidth: [bwReading, t("card.bandwidth"), " kHz", "mdi:arrow-expand-horizontal"],
        spreading_factor: [sfReading, "SF", "", "mdi:signal-variant"],
        tx_power: [txPowReading, t("card.tx_power"), " dBm", "mdi:transmission-tower-export"],
        ch1_voltage: [ch1VReading, t("card.chip_ch1"), " V", "mdi:flash"],
        rate_limiter: [rateLimReading, t("card.chip_rate"), " tok", "mdi:speedometer"],
      };
      // effectiveChipLayout limits hub layouts to the descriptor keys above.
      const descriptor = descriptors[id]!;
      const [reading, label, unit, icon] = descriptor;
      if (id === "spreading_factor" && reading.id && reading.value !== null) {
        return details
          ? this._chip(reading.id, "", `SF${reading.value}`)
          : this._quickChip({ ...reading, value: `SF${reading.value}` }, label, "", icon);
      }
      return details
        ? this._detailChip(reading, label, unit)
        : this._quickChip(reading, label, unit.trimStart(), icon);
    };
    const layout = effectiveChipLayout({ type: "hub", id: pubkey }, cfg!);
    const quickChips = layout.top.map((id) => renderHubChip(id, false)).join("");
    const detailChips = layout.details.map((id) => renderHubChip(id, true)).join("");

    const mqtt = mqttIds.map((id) => {
      const v   = this._val(id);
      const lbl = (this._attr(id, "server") as string | null) ||
        ((this._attr(id, "friendly_name") as string | null) || id)
          .replace(/meshcore\s+\w+\s*/i, "")
          .replace(/_/g, " ")
          .trim();
      return this._chip(id, "", lbl, v ? "mqtt-ok" : "mqtt-err");
    }).join("");

    const location = lat !== null && lon !== null
      ? `<section class="detail-section"><h4>${escapeHtml(t("card.location_section"))}</h4>${this._locLink(lat, lon, latId, t)}</section>`
      : "";

    const detailsBody = this._detailSection(t("card.chips_section"), detailChips)
      + location
      + this._detailSection(t("card.mqtt_section"), mqtt);

    return `${header}
      <div class="device-body ${online ? "" : "node-offline"}">
        ${battery ? `<div class="trim-section">${battery}</div>` : ""}
        ${quickChips ? `<div class="quick-chip-row trim-section">${quickChips}</div>` : ""}
        ${this._renderDetailsDisclosure(pubkey, detailsBody, t)}
      </div>
    `;
  }

  // ── Node rendering ─────────────────────────────────────────────────────────

  private _buildNodeViewModel(node: NodeInfo, t: LocalizeFunc): NodeViewModel {
    const { name, deviceId, ePrefix, eSuffix } = node;
    const p = (m: string) => this._findEntityByDevice(deviceId, m, ePrefix, eSuffix);

    // Common entities
    const authoritativeOnlineId = this._findEntityByDevice(
      deviceId,
      "online",
      ePrefix,
      eSuffix,
      { domain: "binary_sensor", enabledOnly: true, platform: "meshcore" }
    );
    const statusId  = p("status");
    const successId = p("request_successes");
    const rssiId    = p("last_rssi");
    const snrId     = p("last_snr");
    const pathId    = p("path_length");
    const routeId   = p("routing_path");
    const advertId  = p("last_advert");
    const battPctId = this._config?.battery_entity ?? p("battery_percentage") ?? p("battery_level") ?? p("battery");
    let battVId = this._config?.voltage_entity ?? null;
    if (!battVId) {
      battVId = p("battery_voltage");
    }
    if (!battVId && this._hass) {
      for (const [entityId, info] of Object.entries(this._hass.entities)) {
        if (info.device_id !== deviceId) continue;
        // Match voltage-like battery entities, but not percentage/level entities.
        if (/_bat$|_battery_voltage$|_bat_/i.test(entityId) &&
            !/percentage|level/i.test(entityId)) {
          battVId = entityId;
          break;
        }
      }
    }
    const locEntityId = this._config?.location_entity ?? null;
    const contactId   = locEntityId ? null : this._contactEntity(name);
    const latId       = locEntityId ? null : p("latitude");
    const lonId       = locEntityId ? null : p("longitude");

    // Repeater / extras
    const sentId      = p("nb_sent");
    const receivedId  = p("nb_recv");
    const relayedId   = p("relayed");
    const canceledId  = p("canceled");
    const dupId       = p("duplicate");
    const airtimeId   = p("airtime_utilization");
    const rxAirtimeId = p("rx_airtime_utilization");
    const noiseId     = p("noise_floor");
    const queueId     = p("queue_length");
    const uptimeId    = p("uptime");
    const txRateId    = [p("tx_per_minute"), p("tx_rate"), p("messages_per_minute")].find((id) => this._exists(id)) ?? null;
    const rxRateId    = [p("rx_per_minute"), p("rx_rate")].find((id) => this._exists(id)) ?? null;

    // Optional telemetry keeps explicit overrides authoritative, then falls
    // back to the same device-scoped matching used for MeshCore metrics.
    const tempId      = this._config?.temperature_entity ?? p("temperature");
    const humidId     = this._config?.humidity_entity ?? p("humidity");
    const illumId     = this._config?.illuminance_entity ?? p("illuminance");
    const pressId     = this._config?.pressure_entity ?? p("pressure");

    const status  = this._val(statusId);
    const lastAdv = this._val(advertId);
    const rawLat  = locEntityId ? this._attr(locEntityId, "latitude")
                  : contactId  ? this._attr(contactId, "adv_lat") ?? this._attr(contactId, "latitude")
                  : this._val(latId);
    const rawLon  = locEntityId ? this._attr(locEntityId, "longitude")
                  : contactId  ? this._attr(contactId, "adv_lon") ?? this._attr(contactId, "longitude")
                  : this._val(lonId);
    const latNumber = parseFloat(String(rawLat));
    const lonNumber = parseFloat(String(rawLon));
    const lat     = rawLat != null && Number.isFinite(latNumber) && latNumber !== 0 ? rawLat : null;
    const lon     = rawLon != null && Number.isFinite(lonNumber) && lonNumber !== 0 ? rawLon : null;
    const locId   = locEntityId ?? contactId ?? latId;

    const successes = this._val(successId);
    const lastSeen  = formatLastSeen(lastAdv, t);

    // Repeater signals: airtime / rx_airtime / noise_floor entities
    // (always present on repeaters), or _neighbor_*_seen entities
    // (defense-in-depth — kept as a fallback in case the airtime/noise
    // metrics haven't been populated yet on a freshly-paired repeater).
    const isRepeater = !!(airtimeId || rxAirtimeId || noiseId) || (() => {
      if (!this._hass?.entities) return false;
      for (const [entityId, info] of Object.entries(this._hass.entities)) {
        if (info.device_id !== deviceId) continue;
        if (/_neighbor_[0-9a-f]+_seen$/.test(entityId)) return true;
      }
      return false;
    })();
    const isSensor = !isRepeater && !!(p("temperature") || p("humidity") || p("illuminance"));

    // meshcore-ha's enabled, device-scoped connectivity binary sensor is the
    // authority when present. Its unknown state intentionally means the node
    // has not yet been polled successfully during this integration session.
    let connectivity: NodeConnectivityState;
    if (authoritativeOnlineId) {
      const onlineState = this._hass?.states[authoritativeOnlineId]?.state
        .trim()
        .toLowerCase();
      connectivity = onlineState === "on"
        ? "online"
        : onlineState === "off"
          ? "offline"
          : "unknown";
    } else {
      // Compatibility fallback for older integrations, or when users have
      // explicitly disabled the dedicated online entity.
      const uptimeState = uptimeId ? this._hass?.states[uptimeId] : null;
      let legacyOnline: boolean;
      if (uptimeState) {
        if (["unavailable", "unknown"].includes(uptimeState.state)) {
          legacyOnline = false;
        } else {
          const ts = new Date(uptimeState.last_updated).getTime();
          legacyOnline = !isNaN(ts) && (Date.now() - ts) < 6 * 3600 * 1000;
        }
      } else {
        legacyOnline = successes !== null
          ? Number(successes) > 0
          : isOnlineState(status);
      }
      connectivity = legacyOnline ? "online" : "offline";
    }

    // RF settings are retained in the collapsed detail area.
    const sfEntity = p("spreading_factor");
    const freqEntity = p("frequency");
    const bandwidthEntity = p("bandwidth");
    const txPowerEntity = p("tx_power");

    // Clean display name: remove leading "MeshCore " or "MeshCore"
    let displayName = name.replace(/_/g, " ");
    if (displayName.toLowerCase().startsWith("meshcore ")) {
      displayName = displayName.substring(9);
    } else if (displayName.toLowerCase().startsWith("meshcore")) {
      displayName = displayName.substring(8);
    }
    const uptimeReading = this._reading(uptimeId, true);
    uptimeReading.value = formatUptime(uptimeReading.value);
    const batteryVoltage = this._reading(battVId, true);
    if (batteryVoltage.value !== null && Number(batteryVoltage.value) < 0.001) {
      batteryVoltage.value = null;
    }

    return {
      node,
      displayName: displayName.trim(),
      connectivity,
      isRepeater,
      isSensor,
      icon: isRepeater ? "mdi:radio-tower" : isSensor ? "mdi:access-point" : "mdi:radio-handheld",
      firmwareVersion: this._firmwareVersion(deviceId),
      primaryEntityId: authoritativeOnlineId ?? contactId ?? statusId ?? uptimeId ?? rssiId,
      lastSeen,
      rssi: this._reading(rssiId, true),
      snr: this._reading(snrId, true),
      batteryPct: this._reading(battPctId, true),
      batteryVoltage,
      sent: this._reading(sentId, true),
      received: this._reading(receivedId, true),
      temperature: this._reading(tempId, true),
      humidity: this._reading(humidId, true),
      illuminance: this._reading(illumId, true),
      pressure: this._reading(pressId, true),
      route: this._reading(routeId),
      pathLength: this._reading(pathId, true),
      uptime: uptimeReading,
      relayed: this._reading(relayedId, true),
      canceled: this._reading(canceledId, true),
      duplicate: this._reading(dupId, true),
      txAirtime: this._reading(airtimeId, true),
      rxAirtime: this._reading(rxAirtimeId, true),
      noiseFloor: this._reading(noiseId, true),
      queueLength: this._reading(queueId, true),
      txRate: this._reading(txRateId, true),
      rxRate: this._reading(rxRateId, true),
      spreadingFactor: this._reading(sfEntity, true),
      frequency: this._reading(freqEntity, true),
      bandwidth: this._reading(bandwidthEntity, true),
      txPower: this._reading(txPowerEntity, true),
      latitude: lat,
      longitude: lon,
      locationEntityId: locId,
      neighbors: this._getNeighbors(deviceId),
    };
  }

  private _renderNodeHeader(vm: NodeViewModel, t: LocalizeFunc): string {
    const stateLabel = t(`card.${vm.connectivity}`);
    const lastSeen = vm.lastSeen
      ? vm.connectivity === "online"
        ? vm.lastSeen
        : t("card.last_seen", { time: vm.lastSeen })
      : "";
    const secondary = `${stateLabel}${lastSeen ? ` · ${lastSeen}` : ""}`;
    return this._renderDeviceHeader(
      vm.displayName,
      secondary,
      vm.icon,
      vm.connectivity === "online",
      vm.primaryEntityId,
      "",
      vm.connectivity === "unknown" ? "unknown" : "offline",
      vm.connectivity === "unknown" ? "mdi:help" : undefined
    );
  }

  private _detailChip(reading: EntityReading, label: string, unit = ""): string {
    if (!reading.id || reading.value === null) return "";
    return this._chip(reading.id, `${label} `, `${reading.value}${unit}`);
  }

  private _detailSection(title: string, contents: string): string {
    if (!contents) return "";
    return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><div class="detail-chips">${contents}</div></section>`;
  }

  private _renderNodeChip(id: MeshcoreChipId, details: boolean, vm: NodeViewModel, t: LocalizeFunc): string {
    if (id === "firmware") {
      return details
        ? this._staticDetailChip(vm.firmwareVersion, t("card.firmware"))
        : this._staticChip(vm.firmwareVersion, "mdi:memory", vm.firmwareVersion
          ? t("card.firmware_label", { version: vm.firmwareVersion })
          : undefined);
    }
    if (id === "neighbor_count") return this._neighborCountChip(vm.neighbors, t, details);

    const descriptors: Partial<Record<MeshcoreChipId, [EntityReading, string, string, string]>> = {
      sent: [vm.sent, t("card.traffic_sent"), "", "mdi:arrow-up"],
      received: [vm.received, t("card.traffic_received"), "", "mdi:arrow-down"],
      temperature: [vm.temperature, t("card.telemetry_temp"), "°C", "mdi:thermometer"],
      uptime: [vm.uptime, t("card.uptime_label"), "", "mdi:timer-outline"],
      route: [vm.route, t("card.routing_path"), "", "mdi:routes"],
      path_length: [vm.pathLength, t("card.path_length"), "", "mdi:map-marker-distance"],
      spreading_factor: [vm.spreadingFactor, "SF", "", "mdi:signal-variant"],
      frequency: [vm.frequency, t("card.frequency"), " MHz", "mdi:sine-wave"],
      bandwidth: [vm.bandwidth, t("card.bandwidth"), " kHz", "mdi:arrow-expand-horizontal"],
      tx_power: [vm.txPower, t("card.tx_power"), " dBm", "mdi:transmission-tower-export"],
      relayed: [vm.relayed, t("card.traffic_relayed"), "", "mdi:repeat"],
      canceled: [vm.canceled, t("card.traffic_canceled"), "", "mdi:cancel"],
      duplicate: [vm.duplicate, t("card.traffic_duplicate"), "", "mdi:content-duplicate"],
      tx_airtime: [vm.txAirtime, t("card.tx_airtime_label"), "%", "mdi:upload-network"],
      rx_airtime: [vm.rxAirtime, t("card.rx_airtime_label"), "%", "mdi:download-network"],
      queue_length: [vm.queueLength, t("card.chip_queue"), "", "mdi:tray-full"],
      tx_rate: [vm.txRate, t("card.chip_tx_rate"), "", "mdi:upload"],
      rx_rate: [vm.rxRate, t("card.chip_rx_rate"), "", "mdi:download"],
      humidity: [vm.humidity, t("card.telemetry_humidity"), "%", "mdi:water-percent"],
      illuminance: [vm.illuminance, t("card.telemetry_lux"), " lx", "mdi:brightness-5"],
      pressure: [vm.pressure, t("card.telemetry_pressure"), " hPa", "mdi:gauge"],
    };
    // effectiveChipLayout limits node layouts to the special cases above or
    // the descriptor keys in this map.
    const descriptor = descriptors[id]!;
    const [reading, label, unit, icon] = descriptor;
    if (id === "spreading_factor" && reading.id && reading.value !== null) {
      return details
        ? this._chip(reading.id, "", `SF${reading.value}`)
        : this._quickChip({ ...reading, value: `SF${reading.value}` }, label, "", icon);
    }
    return details
      ? this._detailChip(reading, label, unit)
      : this._quickChip(reading, label, unit.trimStart(), icon);
  }

  private _renderNodeDetails(vm: NodeViewModel, t: LocalizeFunc): string {
    const layout = effectiveChipLayout({ type: "node", id: vm.node.name }, this._config!);
    const chips = layout.details.map((id) => this._renderNodeChip(id, true, vm, t)).join("");

    const location = vm.latitude !== null && vm.longitude !== null
      ? `<section class="detail-section"><h4>${escapeHtml(t("card.location_section"))}</h4>${this._locLink(vm.latitude, vm.longitude, vm.locationEntityId, t)}</section>`
      : "";
    const neighbours = this._renderNeighbors(vm.neighbors, t);
    const body = this._detailSection(t("card.chips_section"), chips)
      + location
      + neighbours;
    return this._renderDetailsDisclosure(vm.node.deviceId, body, t);
  }

  private _renderNode(
    node: NodeInfo,
    t: LocalizeFunc,
    viewModel?: NodeViewModel
  ): string {
    const vm = viewModel ?? this._buildNodeViewModel(node, t);
    if (vm.connectivity !== "online") {
      return this._renderNodeHeader(vm, t);
    }

    const cfg = this._config;
    const metrics = cfg?.hide_metrics ? "" : [
      this._metric(vm.rssi, t("card.rssi_label"), "dBm"),
      this._metric(vm.snr, t("card.snr_label"), "dB"),
      this._metric(vm.noiseFloor, t("card.noise_floor_label"), "dBm"),
    ].join("");
    const battery = cfg?.hide_battery
      ? ""
      : this._batteryBlock(vm.batteryPct, vm.batteryVoltage, t);
    const layout = effectiveChipLayout({ type: "node", id: vm.node.name }, cfg!);
    const quickChips = layout.top.map((id) => this._renderNodeChip(id, false, vm, t)).join("");
    const voltageFallback = vm.batteryPct.value === null && !cfg?.hide_battery
      ? this._quickChip(vm.batteryVoltage, t("card.battery_voltage"), "V", "mdi:flash")
      : "";

    return `${this._renderNodeHeader(vm, t)}
      <div class="device-body">
        ${metrics ? `<div class="metrics-grid trim-section" part="metrics">${metrics}</div>` : ""}
        ${battery ? `<div class="trim-section">${battery}</div>` : ""}
        ${quickChips || voltageFallback ? `<div class="quick-chip-row trim-section">${quickChips}${voltageFallback}</div>` : ""}
        ${this._renderNodeDetails(vm, t)}
      </div>`;
  }

  private _renderNeighbors(snapshot: NeighborSnapshot, t: LocalizeFunc): string {
    if (this._config?.show_neighbors === false || !snapshot.supported) return "";
    return renderNeighborSection(snapshot, t, this._config?.max_neighbors);
  }

  // ── Main render ────────────────────────────────────────────────────────────

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = makeLocalize(this._hass.language ?? this._hass.locale?.language ?? "en");
    const target = this._config.target;
    if (
      !target ||
      (target.type !== "hub" && target.type !== "node") ||
      typeof target.id !== "string" ||
      !target.id.trim()
    ) {
      this._cardSize = 1;
      this._setBody(`<div class="empty config-prompt">${escapeHtml(t("card.select_device_prompt"))}</div>`);
      return;
    }

    if (target.type === "hub") {
      const hub = this._discoverHubs().find((item) => item.pubkey === target.id);
      if (!hub) {
        this._cardSize = 1;
        this._setBody(`<div class="empty config-prompt">${escapeHtml(t("card.target_not_found", { id: target.id }))}</div>`);
        return;
      }
      this._cardSize = 5;
      this._seedDetails(hub.pubkey);
      this._setBody(this._renderHub(hub, t));
      return;
    }

    const node = this._discoverNodes().find((item) => item.name === target.id);
    if (!node) {
      this._cardSize = 1;
      this._setBody(`<div class="empty config-prompt">${escapeHtml(t("card.target_not_found", { id: target.id }))}</div>`);
      return;
    }
    const vm = this._buildNodeViewModel(node, t);
    this._cardSize = vm.connectivity === "online" ? 5 : 1;
    this._seedDetails(node.deviceId);
    this._setBody(this._renderNode(node, t, vm), vm.connectivity !== "online");
  }

  private _setBody(body: string, offlineNode = false): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const cls = [
      "device-card",
      constrained ? "grid-rows" : "",
      offlineNode ? "offline-node-card" : "",
    ].filter(Boolean).join(" ");
    this.shadowRoot!.innerHTML = `<style>${STYLES}</style><ha-card class="${cls}">${body}</ha-card>`;
    hydrateTileInfo(this.shadowRoot!);
    if (constrained) this._scheduleTrim(".trim-section");
  }

  private _scheduleTrim(rowSelector: string): void {
    if (this._trimTimer !== null) cancelAnimationFrame(this._trimTimer);
    this.style.opacity = "0";
    this._trimTimer = requestAnimationFrame(() => {
      this._trimTimer = null;
      const card = this.shadowRoot!.querySelector("ha-card") as HTMLElement | null;
      const h = card?.clientHeight ?? 0;
      if (card && h) {
        for (const el of Array.from(card.querySelectorAll<HTMLElement>(rowSelector))) {
          el.style.visibility = el.offsetTop + el.offsetHeight > h ? "hidden" : "";
        }
      }
      this.style.opacity = "";
    });
  }

  getCardSize(): number {
    return this._cardSize;
  }

  getGridOptions(): {
    columns: "full";
    rows: "auto";
    min_columns: number;
    min_rows: number;
  } {
    return {
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 1,
    };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-card-editor");
  }

  static getStubConfig(): MeshcoreCardConfig {
    return {};
  }
}
