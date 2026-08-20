import type { HomeAssistant, MeshcoreContactCardConfig, HaFormElement } from "./types.js";
import { formatLastSeen, escapeHtml, mapLinkUrl } from "./helpers.js";
import { STYLES } from "./styles.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";

const CONTACT_STYLES: string = `
  .contact-list {
    display: flex;
    flex-direction: column;
    gap: var(--mush-spacing, 10px);
  }

  .contact-row {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: var(--mush-spacing, 10px);
    border: var(--ha-card-border-width, 1px) solid var(--mushroom-meshcore-border-color);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
    transition: filter 280ms ease-out;
    cursor: pointer;
  }
  .contact-row:hover { filter: brightness(0.97); }
  .contact-row:active { filter: brightness(0.94); }

  .contact-icon {
    display: flex;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--mushroom-meshcore-icon-radius);
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
    color: var(--mushroom-meshcore-muted-color);
    font-size: var(--mushroom-meshcore-icon-size);
    transition: background-color 280ms ease-out, color 280ms ease-in-out;
  }
  .contact-icon.online {
    background: rgba(var(--mush-rgb-success, var(--rgb-success, 76, 175, 80)), 0.2);
    color: var(--mushroom-meshcore-success-color);
  }
  .contact-icon ha-icon {
    --mdc-icon-size: var(--mushroom-meshcore-icon-symbol-size);
  }
  .contact-icon img {
    width: var(--mushroom-meshcore-icon-size);
    height: var(--mushroom-meshcore-icon-size);
    border-radius: var(--mushroom-meshcore-icon-radius);
    object-fit: cover;
  }

  .contact-info {
    flex: 1;
    min-width: 0;
  }

  .contact-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--mushroom-meshcore-chip-spacing);
  }
  .contact-name {
    color: var(--primary-text-color);
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contact-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--mushroom-meshcore-chip-spacing);
    color: var(--secondary-text-color);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .meta-loc {
    color: var(--mushroom-meshcore-info-color);
    font-weight: 500;
    text-decoration: none;
    transition: opacity 280ms ease-out;
  }
  .meta-loc:hover { opacity: 0.7; }

  .contact-right {
    display: flex;
    flex-shrink: 0;
    align-items: center;
  }
`;

interface ContactEntry {
  entityId: string;
  advName: string;
  nodeType: string;
  lastAdvert: number;
  timeSince: string | null;
  icon: string;
  picture: string | null;
  lat: number | null;
  lon: number | null;
  unknownLocation: boolean;
  online: boolean;
  path: string | null;
}

const DEFAULT_MAX_AGE_DAYS = 7;

export class MeshcoreContactCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreContactCardConfig;
  private _fp: string | null = null;
  private _lastRender = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _trimTimer: ReturnType<typeof requestAnimationFrame> | null = null;

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
    this.shadowRoot!.addEventListener("keydown", (e: Event) => {
      const keyboardEvent = e as KeyboardEvent;
      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
      const target = e.target as Element;
      const el = target.closest("[data-entity]") as HTMLElement | null;
      if (el && target === el) {
        keyboardEvent.preventDefault();
        el.click();
      }
    });
  }

  setConfig(config: MeshcoreContactCardConfig): void {
    this._config = config;
    this._fp = null;
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    // out_path changes are attribute-only updates (no state change), so they
    // must be part of the fingerprint or path changes would never re-render.
    const fp = Object.entries(hass.states)
      .filter(([id]) => /^binary_sensor\.meshcore_.*_contact$/.test(id))
      .map(([id, s]) => `${id}=${s.state}@${s.last_changed}:${s.attributes["out_path_len"] ?? ""}:${s.attributes["out_path"] ?? ""}`)
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

  /** Routing path via out_path/out_path_len contact attributes. Hop hashes
   *  are the first pubkey byte, so a hop resolves to a contact name only
   *  when exactly one known contact matches; otherwise the hex is shown. */
  private _formatPath(
    a: Record<string, unknown>,
    prefixNames: Map<string, string[]>,
    t: LocalizeFunc
  ): string | null {
    const len = Number(a["out_path_len"]);
    if (isNaN(len)) return null;
    if (len === -1) return t("card.path_flood");
    if (len === 0) return t("card.path_direct");
    const hex = String(a["out_path"] ?? "").toLowerCase();
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const hops: string[] = [];
    for (let i = 0; i < len && i * 2 + 2 <= hex.length; i++) {
      const hop = hex.slice(i * 2, i * 2 + 2);
      const names = prefixNames.get(hop);
      hops.push(names?.length === 1 ? names[0] : hop);
    }
    return hops.length ? hops.join(" → ") : null;
  }

  private _discoverContacts(t: LocalizeFunc): ContactEntry[] {
    if (!this._hass) return [];
    const maxAgeDays = this._config?.max_contact_age_days ?? DEFAULT_MAX_AGE_DAYS;
    const cutoff = Date.now() / 1000 - maxAgeDays * 86400;
    const contactStates = Object.entries(this._hass.states)
      .filter(([id]) => /^binary_sensor\.meshcore_.*_contact$/.test(id));

    const prefixNames = new Map<string, string[]>();
    for (const [, state] of contactStates) {
      const a = state.attributes as Record<string, unknown>;
      const pk = String(a["public_key"] ?? "").toLowerCase();
      const name = String(a["adv_name"] ?? "");
      if (!/^[0-9a-f]{2}/.test(pk) || !name) continue;
      const prefix = pk.slice(0, 2);
      prefixNames.set(prefix, [...(prefixNames.get(prefix) ?? []), name]);
    }

    return contactStates
      .map(([entityId, state]): ContactEntry => {
        const a = state.attributes as Record<string, unknown>;
        const now = Date.now() / 1000;
        const rawAdvert = Number(a["last_advert"] ?? 0);
        const lastAdvert = rawAdvert > 0 && rawAdvert <= now
          ? rawAdvert
          : state.last_updated ? new Date(state.last_updated).getTime() / 1000 : 0;
        const rawLat = a["adv_lat"] ?? a["latitude"];
        const rawLon = a["adv_lon"] ?? a["longitude"];
        const lat = rawLat != null && rawLat !== "" ? parseFloat(String(rawLat)) : null;
        const lon = rawLon != null && rawLon !== "" ? parseFloat(String(rawLon)) : null;
        return {
          entityId,
          advName:   String(a["adv_name"] || entityId),
          nodeType:  String(a["node_type_str"] || ""),
          lastAdvert,
          timeSince: formatLastSeen(lastAdvert || null, t),
          icon:      String(a["icon"] || "mdi:account"),
          picture:   a["entity_picture"] ? String(a["entity_picture"]) : null,
          lat:             lat !== null && !isNaN(lat) && lat !== 0 ? lat : null,
          lon:             lon !== null && !isNaN(lon) && lon !== 0 ? lon : null,
          unknownLocation: rawLat != null && rawLon != null && (parseFloat(String(rawLat)) === 0 || parseFloat(String(rawLon)) === 0),
          online:    !["stale", "off", "unavailable", "unknown"].includes(state.state),
          path:      this._config?.show_path ? this._formatPath(a, prefixNames, t) : null,
        };
      })
      .filter((c) => c.lastAdvert >= cutoff)
      .sort((a, b) => b.lastAdvert - a.lastAdvert);
  }

  private _renderRow(c: ContactEntry, t: LocalizeFunc): string {
    const mapUrl = c.lat !== null && c.lon !== null
      ? mapLinkUrl(this._config ?? {}, c.lat, c.lon)
      : null;

    // entity_picture URLs and icon names come from HA contact attributes,
    // which the meshcore integration sources unsanitized from the mesh.
    // Reject anything that isn't a same-origin / http(s) image URL or a
    // simple mdi-style icon name to avoid javascript:/data: schemes and
    // attribute breakout via quotes.
    const safePicture = c.picture && /^(?:https?:\/\/|\/)/i.test(c.picture) ? c.picture : null;
    const safeIcon = /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(c.icon) ? c.icon : "mdi:account";

    return `
      <div class="contact-row" role="button" tabindex="0" aria-label="${escapeHtml(c.advName)}" data-entity="${escapeHtml(c.entityId)}">
        <div class="contact-icon ${c.online ? "online" : "offline"}">
          ${safePicture
            ? `<img src="${escapeHtml(safePicture)}" alt="">`
            : `<ha-icon icon="${escapeHtml(safeIcon)}"></ha-icon>`}
        </div>
        <div class="contact-info">
          <div class="contact-header">
            <span class="contact-name">${escapeHtml(c.advName)}</span>
            ${c.nodeType ? `<span class="type-badge">${escapeHtml(c.nodeType)}</span>` : ""}
          </div>
          <div class="contact-meta">
            ${c.timeSince ? `<span>${escapeHtml(c.timeSince)}</span>` : ""}
            ${mapUrl ? `<a class="meta-loc" href="${mapUrl}" target="_blank" rel="noopener">📍 ${c.lat!.toFixed(5)}, ${c.lon!.toFixed(5)}</a>` : c.unknownLocation ? `<span class="dim">${escapeHtml(t("card.unknown_location"))}</span>` : ""}
            ${c.path ? `<span>↝ ${escapeHtml(c.path)}</span>` : ""}
          </div>
        </div>
        <div class="contact-right">
          <span class="status-dot ${c.online ? "dot-online" : "dot-offline"}"></span>
        </div>
      </div>`;
  }

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = makeLocalize(this._hass.language ?? this._hass.locale?.language ?? "en");
    const contacts = this._discoverContacts(t);
    if (!contacts.length) {
      this._setBody(`<div class="empty">${t("card.empty_contacts")}</div>`);
      return;
    }
    this._setBody(
      `<div class="section-label">${t("card.section_contacts")}</div>` +
      `<div class="contact-list">${contacts.map((c) => this._renderRow(c, t)).join("")}</div>`
    );
  }

  private _setBody(body: string): void {
    const constrained = !!this._config?.grid_options?.rows;
    const cls = constrained ? " class=\"grid-rows\"" : "";
    this.shadowRoot!.innerHTML = `<style>${STYLES}${CONTACT_STYLES}</style><ha-card${cls}>${body}</ha-card>`;
    if (constrained) this._scheduleTrim(".contact-row");
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
    return 4;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-contact-card-editor");
  }

  static getStubConfig(): MeshcoreContactCardConfig {
    return { max_contact_age_days: DEFAULT_MAX_AGE_DAYS };
  }
}

export class MeshcoreContactCardEditor extends HTMLElement {
  private _config?: MeshcoreContactCardConfig;
  private _hass?: HomeAssistant;

  setConfig(config: MeshcoreContactCardConfig): void {
    this._config = { ...config };
    this._renderEditor();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const form = this.querySelector("ha-form") as HaFormElement | null;
    if (form) form.hass = hass;
  }

  private _renderEditor(): void {
    if (!this._config) return;
    while (this.lastChild) this.removeChild(this.lastChild);

    const form = document.createElement("ha-form") as HaFormElement;
    form.hass = this._hass!;
    const t = makeLocalize(this._hass?.language ?? this._hass?.locale?.language ?? "en");
    form.schema = [
      {
        name: "max_contact_age_days",
        label: t("editor.max_contact_age"),
        selector: { number: { min: 1, max: 365, step: 1, unit_of_measurement: "days", mode: "box" } } as never,
      },
      { name: "show_path", label: t("editor.show_path"), selector: { boolean: {} } },
      {
        name: "map_provider",
        label: t("editor.map_provider"),
        selector: { select: { mode: "dropdown", options: [
          { value: "analyzer",   label: "LetsMesh Analyzer" },
          { value: "meshmapper", label: "MeshMapper" },
        ] } },
      },
      { name: "map_metro", label: t("editor.map_metro"), selector: { text: {} } },
    ];
    form.data = {
      max_contact_age_days: this._config.max_contact_age_days ?? DEFAULT_MAX_AGE_DAYS,
      show_path: this._config.show_path === true,
      map_provider: this._config.map_provider === "meshmapper" ? "meshmapper" : "analyzer",
      map_metro: this._config.map_metro ?? "",
    };
    form.computeLabel = (s) => ("label" in s ? s.label : undefined) ?? s.name;

    form.addEventListener("value-changed", (e: Event) => {
      const value = (e as CustomEvent<{ value: Record<string, unknown> }>).detail.value;
      const cfg: MeshcoreContactCardConfig = { ...this._config, max_contact_age_days: Number(value["max_contact_age_days"]) };
      // Only store non-defaults so the YAML stays minimal.
      if (value["show_path"] === true) cfg.show_path = true;
      else delete cfg.show_path;
      if (value["map_provider"] === "meshmapper") cfg.map_provider = "meshmapper";
      else delete cfg.map_provider;
      const metro = String(value["map_metro"] ?? "").trim();
      if (metro) cfg.map_metro = metro;
      else delete cfg.map_metro;
      this._config = cfg;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config } }));
    });

    this.appendChild(form);
  }
}
