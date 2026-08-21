import type {
  HomeAssistant,
  MeshcoreCardConfig,
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
import { STYLES } from "./styles.js";
import { discoverHubs, discoverNodes } from "./discovery.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";

interface EntityReading {
  id: string | null;
  value: string | null;
}

interface NodeViewModel {
  node: NodeInfo;
  displayName: string;
  online: boolean;
  isRepeater: boolean;
  isSensor: boolean;
  icon: string;
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
}

export class MeshcoreCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreCardConfig;
  private _fp: string | null = null;
  private _lastRender = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _trimTimer: ReturnType<typeof requestAnimationFrame> | null = null;
  private _openDetails = new Set<string>();
  private _cardSize = 1;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot!.addEventListener("click", (e: Event) => {
      const el = (e.target as Element).closest("[data-entity]") as HTMLElement | null;
      if (el?.dataset["entity"]) {
        const event = new Event("hass-more-info", { bubbles: true, composed: true });
        (event as Event & { detail: { entityId: string } }).detail = {
          entityId: el.dataset["entity"],
        };
        this.dispatchEvent(event);
      }
    });
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

  setConfig(config: MeshcoreCardConfig): void {
    const previousTarget = this._config?.target;
    this._config = { ...config };
    if (
      previousTarget &&
      (previousTarget.type !== config.target?.type || previousTarget.id !== config.target?.id)
    ) {
      this._openDetails.clear();
    }
    this._fp = null; // force re-render on config change
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const fp = Object.entries(hass.states)
      .filter(([id]) => id.includes("meshcore"))
      .map(([id, s]) => `${id}=${s.state}@${s.last_changed}`)
      .join("|");
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
    eSuffix: string
  ): string | null {
    if (!deviceId || !this._hass?.entities) return null;
    const pLen = (ePrefix || "").length;
    const sLen = (eSuffix || "").length;
    // First pass: strip the discovered prefix/suffix and match the metric
    // exactly (or as the last underscored segment of the core). This is
    // the precise path when discovery's eSuffix correctly identifies the
    // node-name slug.
    for (const [entityId, info] of Object.entries(this._hass.entities)) {
      if (info.device_id !== deviceId) continue;
      const core = entityId.slice(pLen, sLen ? -sLen : undefined);
      if (core === metric || core.endsWith(`_${metric}`)) return entityId;
    }
    // Fallback for older entity-ID formats with no node-name suffix:
    // accept entities whose ID ends exactly in `_<metric>`. We don't
    // also `includes(_<metric>_)` because that over-matches — e.g.
    // `_battery_percentage_*` would falsely satisfy metric "battery".
    for (const [entityId, info] of Object.entries(this._hass.entities)) {
      if (info.device_id !== deviceId) continue;
      if (entityId.endsWith(`_${metric}`)) return entityId;
    }
    return null;
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
    trailing = ""
  ): string {
    const stateClass = online ? "online" : "offline";
    const label = secondary ? `${displayName}, ${secondary}` : displayName;
    const tag = primaryEntityId ? "button" : "div";
    const attributes = primaryEntityId
      ? `type="button" data-entity="${escapeHtml(primaryEntityId)}" aria-label="${escapeHtml(label)}"`
      : `role="group" aria-label="${escapeHtml(label)}"`;

    return `<div class="device-header-row ${stateClass}" part="device-header">
      <${tag} class="device-header ${primaryEntityId ? "clickable" : ""}" ${attributes}>
        <span class="device-icon-shape" aria-hidden="true">
          <ha-tile-icon>
            <ha-icon slot="icon" icon="${escapeHtml(icon)}"></ha-icon>
          </ha-tile-icon>
        </span>
        <ha-tile-info>
          <span slot="primary">${escapeHtml(displayName)}</span>
          ${secondary ? `<span slot="secondary">${escapeHtml(secondary)}</span>` : ""}
        </ha-tile-info>
      </${tag}>
      ${trailing}
    </div>`;
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
    return `<button type="button" class="chip ${cls} clickable" data-entity="${escapeHtml(id)}" aria-label="${escapeHtml(ariaLabel)}">${
      label ? `<span class="chip-label">${escapeHtml(label)}</span>` : ""
    }${blank ? "—" : escapeHtml(value)}</button>`;
  }

  private _metric(reading: EntityReading, label: string, unit: string): string {
    if (!reading.id || reading.value === null) return "";
    const ariaLabel = `${label} ${reading.value}${unit ? ` ${unit}` : ""}`;
    return `<button type="button" class="node-metric clickable" part="metric" data-entity="${escapeHtml(reading.id)}" aria-label="${escapeHtml(ariaLabel)}">
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

  private _getNeighbors(deviceId: string): any[] {
    if (!this._hass || !deviceId) return [];
    
    const neighbors: any[] = [];
    const neighborMap = new Map<string, any>();
    
    // Find all neighbor entities for this device
    for (const [entityId, info] of Object.entries(this._hass.entities || {})) {
      if (info.device_id !== deviceId) continue;
      
      // Match neighbor_XXXXXX_seen entities (raw ID value)
      const seenMatch = entityId.match(/_neighbor_([0-9a-f]+)_seen$/);
      if (seenMatch) {
        const neighborId = seenMatch[1];
        if (!neighborMap.has(neighborId)) {
          neighborMap.set(neighborId, {});
        }
        const seenVal = this._val(entityId);
        if (seenVal !== null && seenVal !== 'unknown' && seenVal !== 'unavailable') {
          const existing = neighborMap.get(neighborId)!;
          existing.rawSeen = seenVal;
          existing.seenId = entityId;
        }
      }
      
      // Match neighbor_XXXXXX entities (SNR value)
      const neighborMatch = entityId.match(/_neighbor_([0-9a-f]+)$/);
      if (neighborMatch && !entityId.endsWith('_seen')) {
        const neighborId = neighborMatch[1];
        if (!neighborMap.has(neighborId)) {
          neighborMap.set(neighborId, {});
        }
        const val = this._val(entityId);
        const state = this._hass?.states[entityId];
        
        // Get timestamp of LAST CHANGE - when SNR actually changed
        let lastSeenTimestamp = null;
        if (state && state.last_changed) {
          lastSeenTimestamp = new Date(state.last_changed).getTime() / 1000;
        } else if (state && state.last_updated) {
          lastSeenTimestamp = new Date(state.last_updated).getTime() / 1000;
        }
        
        // Only if we don't already have lastSeen from SEEN entity (or it's older)
        const existing = neighborMap.get(neighborId)!;
        const existingLastSeen = existing.lastSeen;
        if (lastSeenTimestamp && (!existingLastSeen || lastSeenTimestamp < existingLastSeen)) {
          existing.lastSeen = lastSeenTimestamp;
        }
        
        if (val !== null && val !== 'unknown' && val !== 'unavailable') {
          const numVal = parseFloat(val);
          if (!isNaN(numVal)) {
            existing.snr = numVal;
            existing.snrId = entityId;
          }
        }
      }
    }
    
    // Get neighbor names from contact entities
    for (const [neighborId, data] of neighborMap) {
      let neighborName = neighborId.substring(0, 8);
      let contactEntityId = null;
      
      for (const [entityId, state] of Object.entries(this._hass.states)) {
        if (!/^binary_sensor\.meshcore_.*_contact$/.test(entityId)) continue;
        
        const advId = state.attributes["adv_id"];
        if (advId && String(advId) === neighborId) {
          neighborName = state.attributes["adv_name"] || neighborName;
          contactEntityId = entityId;
          break;
        }
        
        if (entityId.includes(neighborId)) {
          neighborName = state.attributes["adv_name"] || neighborName;
          contactEntityId = entityId;
          break;
        }
      }
      
      neighbors.push({
        id: neighborId,
        name: neighborName,
        contactEntityId: contactEntityId,
        snr: data.snr ?? null,
        snrId: data.snrId ?? null,
        lastSeen: data.lastSeen ?? null,
        rawSeen: data.rawSeen ?? null,
        seenId: data.seenId ?? null,
      });
    }
    
    // Sort by SNR (best first)
    neighbors.sort((a, b) => {
      const aSnr = a.snr !== null ? Number(a.snr) : -100;
      const bSnr = b.snr !== null ? Number(b.snr) : -100;
      return bSnr - aSnr;
    });
    
    return neighbors;
  }

  private _getSnrClass(snr: number | string | null): string {
    const v = Number(snr);
    if (isNaN(v)) return 'dim';
    if (v >= 10) return 'green';
    if (v >= 6) return 'yellow';
    if (v >= 0) return 'orange';
    return 'red';
  }

  private _formatNeighborLastSeen(timestamp: number | null): string {
    if (!timestamp) return '?';
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 0) return '?';
    if (diff < 60) {
      const seconds = Math.floor(diff);
      return `${seconds}s`;
    }
    if (diff < 3600) {
      const minutes = Math.floor(diff / 60);
      return `${minutes}m`;
    }
    if (diff < 86400) {
      const hours = Math.ceil(diff / 3600);
      return `${hours}h`;
    }
    const days = Math.floor(diff / 86400);
    return `${days}d`;
  }

  // ── Hub rendering ──────────────────────────────────────────────────────────

  private _renderHub(hub: HubInfo, t: LocalizeFunc): string {
    const { pubkey, name } = hub;
    const e = (m: string) => this._hubEntity(pubkey, name, m);

    const statusId  = e("node_status");
    const countId   = hub.nodeCountEntity;
    const battPctId = this._config?.battery_entity ?? e("battery_percentage");
    const battVId   = this._config?.voltage_entity  ?? e("battery_voltage");
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
    const battPct   = this._reading(battPctId, true).value;
    const battV     = this._reading(battVId, true).value;
    const nodeCount = this._reading(countId, true).value;
    const freq      = this._reading(freqId, true).value;
    const bw        = this._reading(bwId, true).value;
    const sf        = this._reading(sfId, true).value;
    const txPow     = this._reading(txPowId, true).value;
    const lat       = this._reading(latId, true).value;
    const lon       = this._reading(lonId, true).value;

    const hwModel  = this._attr(statusId, "hw_model") || this._attr(countId, "hw_model");
    const firmware = this._attr(statusId, "firmware_version") || this._attr(countId, "firmware_version");

    const online  = isOnlineState(status);
    const battCol = batteryColor(battPct);
    const showRf  = freq || bw || sf || txPow;

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
      ? `<button type="button" class="count-badge clickable" data-entity="${escapeHtml(countId)}" aria-label="${escapeHtml(t("card.nodes_count", { n: nodeCount }))}">${escapeHtml(t("card.nodes_count", { n: nodeCount }))}</button>`
      : "";
    const header = this._renderDeviceHeader(
      displayName.trim(),
      secondary,
      "mdi:router-wireless",
      online,
      statusId ?? countId,
      nodeCountChip
    );

    return `${header}
      <div class="device-body ${online ? "" : "node-offline"}">
        ${hwModel || firmware ? `<div class="hw-info trim-section">${[hwModel, firmware].filter(Boolean).map((s) => escapeHtml(s)).join(" • ")}</div>` : ""}

        ${battPct !== null && Number(battPct) !== 0 ? `
          <div class="bar-row trim-section">
            <span class="bar-label">${escapeHtml(t("card.battery_label"))}</span>
            <span class="bar-label-right">
              ${battV !== null && parseFloat(battV) >= 0.001 && battVId ? `<button type="button" class="inline-entity clickable" data-entity="${escapeHtml(battVId)}">⚡ ${parseFloat(battV).toFixed(3)}V</button>` : ""}
              ${battPctId ? `<button type="button" class="bar-val inline-entity clickable" data-entity="${escapeHtml(battPctId)}" style="color:${battCol}">${escapeHtml(battPct)}%</button>` : ""}
            </span>
          </div>
          <div class="trim-section">${this._progressBar(battPct, battCol, t("card.battery_label"))}</div>` : ""}

        ${showRf ? `
          <section class="trim-section"><div class="section-header">${escapeHtml(t("card.technical_section"))}</div>
          <div class="rf-row">
            ${freq ? `<span class="rf-chip clickable" data-entity="${escapeHtml(freqId)}">${parseFloat(freq).toFixed(3)} MHz</span>` : ""}
            ${bw   ? `<span class="rf-chip clickable" data-entity="${escapeHtml(bwId)}">${escapeHtml(bw)} kHz</span>` : ""}
            ${sf   ? `<span class="rf-chip clickable" data-entity="${escapeHtml(sfId)}">SF${escapeHtml(sf)}</span>` : ""}
            ${txPow ? `<span class="rf-chip clickable" data-entity="${escapeHtml(txPowId)}">${escapeHtml(txPow)} dBm</span>` : ""}
          </div></section>` : ""}

        ${lat !== null && lon !== null ? `
          <section class="trim-section"><div class="section-header">${escapeHtml(t("card.location_section"))}</div>
          ${this._locLink(lat, lon, latId, t)}</section>` : ""}

        ${mqttIds.length ? `
          <section class="trim-section"><div class="section-header">${escapeHtml(t("card.mqtt_section"))}</div>
          <div class="mqtt-row">
            ${mqttIds.map((id) => {
              const v   = this._val(id);
              const lbl = (this._attr(id, "server") as string | null) ||
                ((this._attr(id, "friendly_name") as string | null) || id)
                  .replace(/meshcore\s+\w+\s*/i, "")
                  .replace(/_/g, " ")
                  .trim();
              return `<span class="mqtt-pill ${v ? "ok" : "err"} clickable" data-entity="${escapeHtml(id)}">${escapeHtml(lbl)}</span>`;
            }).join("")}
          </div></section>` : ""}

        ${(this._exists(rateLimId) || this._exists(ch1VId)) ? `
          <section class="trim-section"><div class="section-header">${escapeHtml(t("card.other_section"))}</div>
          <div class="chip-row">
            ${this._exists(ch1VId) ? this._chip(ch1VId, t("card.chip_ch1"), (this._val(ch1VId) ?? "—") + "V") : ""}
            ${this._exists(rateLimId) ? this._chip(rateLimId, t("card.chip_rate"), (this._val(rateLimId) ?? "—") + " tok") : ""}
          </div></section>` : ""}
      </div>
    `;
  }

  // ── Node rendering ─────────────────────────────────────────────────────────

  private _buildNodeViewModel(node: NodeInfo, t: LocalizeFunc): NodeViewModel {
    const { name, deviceId, ePrefix, eSuffix } = node;
    const p = (m: string) => this._findEntityByDevice(deviceId, m, ePrefix, eSuffix);

    // Common entities
    const statusId  = p("online") ?? p("status");
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

    // If the device has an uptime sensor (repeaters do), trust that:
    // it counts as "up" while we've heard a fresh state in the last 6 hours.
    // Otherwise fall back to request_successes / status text.
    const uptimeState = uptimeId ? this._hass?.states[uptimeId] : null;
    let online: boolean;
    if (uptimeState) {
      if (["unavailable", "unknown"].includes(uptimeState.state)) {
        online = false;
      } else {
        const ts = new Date(uptimeState.last_updated).getTime();
        online = !isNaN(ts) && (Date.now() - ts) < 6 * 3600 * 1000;
      }
    } else {
      online = successes !== null ? Number(successes) > 0 : isOnlineState(status);
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
      online,
      isRepeater,
      isSensor,
      icon: isRepeater ? "mdi:radio-tower" : isSensor ? "mdi:access-point" : "mdi:radio-handheld",
      primaryEntityId: contactId ?? statusId ?? uptimeId ?? rssiId,
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
    };
  }

  private _renderNodeHeader(vm: NodeViewModel, t: LocalizeFunc): string {
    const stateLabel = t(vm.online ? "card.online" : "card.offline");
    const lastSeen = vm.lastSeen
      ? vm.online
        ? vm.lastSeen
        : t("card.last_seen", { time: vm.lastSeen })
      : "";
    const secondary = `${stateLabel}${lastSeen ? ` · ${lastSeen}` : ""}`;
    return this._renderDeviceHeader(
      vm.displayName,
      secondary,
      vm.icon,
      vm.online,
      vm.primaryEntityId
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

  private _renderNodeDetails(vm: NodeViewModel, t: LocalizeFunc): string {
    const technical = [
      this._detailChip(vm.route, t("card.routing_path")),
      this._detailChip(vm.pathLength, t("card.path_length")),
      this._detailChip(vm.spreadingFactor, "SF"),
      this._detailChip(vm.frequency, t("card.frequency"), " MHz"),
      this._detailChip(vm.bandwidth, t("card.bandwidth"), " kHz"),
      this._detailChip(vm.txPower, t("card.tx_power"), " dBm"),
    ].join("");

    const statistics = [
      this._detailChip(vm.relayed, t("card.traffic_relayed")),
      this._detailChip(vm.canceled, t("card.traffic_canceled")),
      this._detailChip(vm.duplicate, t("card.traffic_duplicate")),
      this._detailChip(vm.txAirtime, t("card.tx_airtime_label"), "%"),
      this._detailChip(vm.rxAirtime, t("card.rx_airtime_label"), "%"),
      this._detailChip(vm.queueLength, t("card.chip_queue")),
      this._detailChip(vm.txRate, t("card.chip_tx_rate")),
      this._detailChip(vm.rxRate, t("card.chip_rx_rate")),
    ].join("");

    const telemetry = [
      this._detailChip(vm.humidity, t("card.telemetry_humidity"), "%"),
      this._detailChip(vm.illuminance, t("card.telemetry_lux"), " lx"),
      this._detailChip(vm.pressure, t("card.telemetry_pressure"), " hPa"),
    ].join("");

    const location = vm.latitude !== null && vm.longitude !== null
      ? `<section class="detail-section"><h4>${escapeHtml(t("card.location_section"))}</h4>${this._locLink(vm.latitude, vm.longitude, vm.locationEntityId, t)}</section>`
      : "";
    const neighbours = this._renderNeighbors(vm.node, t);
    const body = this._detailSection(t("card.technical_section"), technical)
      + this._detailSection(t("card.traffic_section"), statistics)
      + location
      + this._detailSection(t("card.telemetry_section"), telemetry)
      + neighbours;
    if (!body) return "";

    const open = this._openDetails.has(vm.node.deviceId) ? " open" : "";
    return `<details class="node-details" part="details" data-node-id="${escapeHtml(vm.node.deviceId)}"${open}>
      <summary><span>${escapeHtml(t("card.details"))}</span><ha-icon icon="mdi:chevron-down"></ha-icon></summary>
      <div class="details-content trim-section">${body}</div>
    </details>`;
  }

  private _renderNode(
    node: NodeInfo,
    t: LocalizeFunc,
    viewModel?: NodeViewModel
  ): string {
    const vm = viewModel ?? this._buildNodeViewModel(node, t);
    if (!vm.online) {
      return this._renderNodeHeader(vm, t);
    }

    const metrics = [
      this._metric(vm.rssi, t("card.rssi_label"), "dBm"),
      this._metric(vm.snr, t("card.snr_label"), "dB"),
      this._metric(vm.noiseFloor, t("card.noise_floor_label"), "dBm"),
    ].join("");
    const voltage = vm.batteryVoltage.value !== null
      ? Number(vm.batteryVoltage.value).toFixed(2)
      : null;
    const battery = vm.batteryPct.value !== null
      ? `<div class="battery-block" part="battery">
          <div class="battery-meta">
            <span>${escapeHtml(t("card.battery_label"))}</span>
            <span class="battery-values">
              ${vm.batteryPct.id ? `<button type="button" class="battery-percentage clickable" data-entity="${escapeHtml(vm.batteryPct.id)}" aria-label="${escapeHtml(t("card.battery_label"))} ${escapeHtml(vm.batteryPct.value)}%">${escapeHtml(vm.batteryPct.value)}%</button>` : ""}
              ${voltage && vm.batteryVoltage.id ? `<button type="button" class="battery-voltage clickable" data-entity="${escapeHtml(vm.batteryVoltage.id)}" aria-label="${escapeHtml(t("card.battery_voltage"))} ${voltage} V">${voltage} V</button>` : ""}
            </span>
          </div>
          ${this._progressBar(vm.batteryPct.value, batteryColor(vm.batteryPct.value), t("card.battery_label"))}
        </div>`
      : "";
    const quickChips = [
      this._quickChip(vm.sent, t("card.traffic_sent"), "", "mdi:arrow-up"),
      this._quickChip(vm.received, t("card.traffic_received"), "", "mdi:arrow-down"),
      this._quickChip(vm.temperature, t("card.telemetry_temp"), "°C", "mdi:thermometer"),
      this._quickChip(vm.uptime, t("card.uptime_label"), "", "mdi:timer-outline"),
      vm.batteryPct.value === null
        ? this._quickChip(vm.batteryVoltage, t("card.battery_voltage"), "V", "mdi:flash")
        : "",
    ].join("");

    return `${this._renderNodeHeader(vm, t)}
      <div class="device-body">
        ${metrics ? `<div class="metrics-grid trim-section" part="metrics">${metrics}</div>` : ""}
        ${battery ? `<div class="trim-section">${battery}</div>` : ""}
        ${quickChips ? `<div class="quick-chip-row trim-section">${quickChips}</div>` : ""}
        ${this._renderNodeDetails(vm, t)}
      </div>`;
  }

  private _renderNeighbors(node: NodeInfo, t: LocalizeFunc): string {
    if (this._config?.show_neighbors === false) return "";

    const neighbors = this._getNeighbors(node.deviceId);
    const neighborsWithSnr = neighbors.filter(n => n.snr !== null && !isNaN(parseFloat(n.snr)));
    
    if (neighborsWithSnr.length === 0) {
      return `
        <div class="neighbors-section">
          <div class="neighbors-header">
            <span>${escapeHtml(t("card.neighbors_label") || "Neighbors")}</span>
            <span class="count-badge">${neighborsWithSnr.length}</span>
          </div>
          <div style="font-size: 11px; color: var(--secondary-text-color); text-align: center; padding: 8px;">
            ${escapeHtml(t("card.no_neighbors_info") || "No information about neighbors")}
          </div>
        </div>
      `;
    }
    
    // Cap the list (neighbors are sorted best-SNR-first, so the cap keeps
    // the strongest links); the count badge still shows the full total.
    const cap = this._config?.max_neighbors;
    const shownNeighbors = cap && cap > 0 ? neighborsWithSnr.slice(0, cap) : neighborsWithSnr;

    const neighborRows = shownNeighbors.map(n => {
      const snr = parseFloat(n.snr).toFixed(1);
      const snrClass = this._getSnrClass(snr);
      const timeString = this._formatNeighborLastSeen(n.lastSeen);
      const rawSeen = n.rawSeen || null;
      const lastSeenLabel = t("card.neighbor_last_seen") || "Last seen";
      const contactsLabel = t("card.neighbor_contacts") || "Connections (48h)";
      const nameEntityId = n.contactEntityId || n.snrId;
      const name = nameEntityId
        ? `<button type="button" class="neighbor-name clickable" data-entity="${escapeHtml(nameEntityId)}">${escapeHtml(n.name)}</button>`
        : `<span class="neighbor-name">${escapeHtml(n.name)}</span>`;
      
      return `
        <div class="neighbor-row">
          <div class="neighbor-main">
            ${name}
            <button type="button" class="neighbor-snr ${snrClass} clickable" data-entity="${escapeHtml(n.snrId || "")}" aria-label="${escapeHtml(t("card.snr_label"))} ${escapeHtml(snr)} dB"><ha-icon icon="mdi:signal"></ha-icon>${escapeHtml(snr)} dB</button>
          </div>
          <div class="neighbor-stats">
            <span class="neighbor-stat">🕒 ${escapeHtml(lastSeenLabel)}: ${escapeHtml(timeString)}</span>
            ${rawSeen ? `<span class="neighbor-stat">🔗 ${escapeHtml(contactsLabel)}: ${escapeHtml(rawSeen)}x</span>` : ""}
          </div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="neighbors-section">
        <div class="neighbors-header">
          <span>${escapeHtml(t("card.neighbors_label") || "Neighbors")}</span>
          <span class="count-badge">${neighborsWithSnr.length}</span>
        </div>
        <div class="neighbors-list">
          ${neighborRows}
        </div>
      </div>
    `;
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
    this._cardSize = vm.online ? 5 : 1;
    this._setBody(this._renderNode(node, t, vm), !vm.online);
  }

  private _setBody(body: string, offlineNode = false): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const cls = [
      "device-card",
      constrained ? "grid-rows" : "",
      offlineNode ? "offline-node-card" : "",
    ].filter(Boolean).join(" ");
    this.shadowRoot!.innerHTML = `<style>${STYLES}</style><ha-card class="${cls}">${body}</ha-card>`;
    this._hydrateTileInfo();
    if (constrained) this._scheduleTrim(".trim-section");
  }

  private _hydrateTileInfo(): void {
    const applyProperties = (): void => {
      for (const info of Array.from(this.shadowRoot!.querySelectorAll("ha-tile-info"))) {
        const primary = info.querySelector<HTMLElement>('[slot="primary"]')?.textContent ?? "";
        const secondary = info.querySelector<HTMLElement>('[slot="secondary"]')?.textContent ?? "";
        const tileInfo = info as HTMLElement & { primary: string; secondary: string };
        tileInfo.primary = primary;
        tileInfo.secondary = secondary;
      }
    };

    if (customElements.get("ha-tile-info")) {
      applyProperties();
    } else {
      void customElements.whenDefined?.("ha-tile-info").then(applyProperties);
    }
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
