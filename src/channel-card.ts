import type { HomeAssistant, MeshcoreChannelCardConfig } from "./types.js";
import { escapeHtml } from "./helpers.js";
import { STYLES } from "./styles.js";
import { makeLocalize, type LocalizeFunc } from "./localize.js";

const CHANNEL_STYLES: string = `
  .channel-list {
    display: flex;
    flex-direction: column;
    gap: var(--mush-spacing, 10px);
  }

  .channel-row {
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
  .channel-row:hover { filter: brightness(0.97); }
  .channel-row:active { filter: brightness(0.94); }

  .channel-icon {
    display: flex;
    width: var(--mushroom-meshcore-icon-size);
    height: var(--mushroom-meshcore-icon-size);
    flex: 0 0 var(--mushroom-meshcore-icon-size);
    align-items: center;
    justify-content: center;
    border-radius: var(--mushroom-meshcore-icon-radius);
    font-size: var(--mushroom-meshcore-icon-size);
    transition: background-color 280ms ease-out, color 280ms ease-in-out;
  }
  .channel-icon ha-icon {
    --mdc-icon-size: var(--mushroom-meshcore-icon-symbol-size);
  }
  .channel-icon.active {
    background: rgba(var(--mush-rgb-success, var(--rgb-success, 76, 175, 80)), 0.2);
    color: var(--mushroom-meshcore-success-color);
  }
  .channel-icon.inactive {
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
    color: var(--mushroom-meshcore-muted-color);
  }

  .channel-info {
    flex: 1;
    min-width: 0;
  }

  .channel-dot {
    width: var(--mushroom-meshcore-badge-size);
    height: var(--mushroom-meshcore-badge-size);
    flex-shrink: 0;
    border-radius: var(--mushroom-meshcore-badge-radius);
  }
  .channel-dot.active {
    background: var(--mushroom-meshcore-success-color);
  }
  .channel-dot.inactive {
    background: var(--mushroom-meshcore-muted-color);
    opacity: 0.55;
  }

  .channel-hub {
    overflow: hidden;
    color: var(--secondary-text-color);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel-name {
    overflow: hidden;
    color: var(--primary-text-color);
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

interface ChannelEntry {
  entityId: string;
  hubName: string;
  channelName: string;
  channelIndex: number;
  active: boolean;
}

/**
 * Parse hub name and channel name from a channel entity.
 *
 * Entity ID pattern:  binary_sensor.meshcore_<hubprefix>_ch_<index>_messages
 * Friendly name pattern: MeshCore <HubName> (<hubprefix>) <ChannelName> Messages
 *
 * We prefer the friendly_name parser because it carries the human-readable hub
 * name and channel name. Fall back to the entity ID when the name is absent.
 */
function parseChannel(entityId: string, attrs: Record<string, unknown>): { hubName: string; channelName: string; channelIndex: number } {
  const channelIndex = typeof attrs["channel_index"] === "number" ? attrs["channel_index"] : 0;

  // Hub prefix and index always come from the entity ID
  const idm = entityId.match(/^binary_sensor\.meshcore_([^_]+(?:_[^_]+)*)_ch_(\d+)_messages$/);
  const hubFromId = idm ? idm[1]! : entityId;
  const chIdx     = idm ? parseInt(idm[2]!, 10) : channelIndex;

  const friendly = String(attrs["friendly_name"] ?? "");

  // Full format: "MeshCore YubaWifi (55733c) Public Messages"
  const full = friendly.match(/^MeshCore\s+(.+?)\s+\([0-9a-f]+\)\s+(.+?)\s+Messages\b/i);
  if (full) {
    return { hubName: full[1]!, channelName: full[2]!, channelIndex: chIdx };
  }

  // Short format: "Public Messages" — strip trailing " Messages"
  const short = friendly.match(/^(.+?)\s+Messages\b/i);
  if (short) {
    return { hubName: hubFromId, channelName: short[1]!, channelIndex: chIdx };
  }

  return { hubName: hubFromId, channelName: friendly || `Ch ${chIdx}`, channelIndex: chIdx };
}

export class MeshcoreChannelCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: MeshcoreChannelCardConfig;
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

  setConfig(config: MeshcoreChannelCardConfig): void {
    this._config = config;
    this._fp = null;
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    const fp = Object.entries(hass.states)
      .filter(([id]) => /^binary_sensor\.meshcore_.*_ch_\d+_messages$/.test(id))
      .map(([id, s]) => `${id}=${s.state}`)
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

  private _discoverChannels(): ChannelEntry[] {
    if (!this._hass) return [];
    return Object.entries(this._hass.states)
      .filter(([id]) => /^binary_sensor\.meshcore_.*_ch_\d+_messages$/.test(id))
      .map(([entityId, state]): ChannelEntry => {
        const attrs = state.attributes as Record<string, unknown>;
        const { hubName, channelName, channelIndex } = parseChannel(entityId, attrs);
        return {
          entityId,
          hubName,
          channelName,
          channelIndex,
          active: state.state === "Active",
        };
      })
      .sort((a, b) => {
        const ch = a.channelIndex - b.channelIndex;
        return ch !== 0 ? ch : a.hubName.localeCompare(b.hubName);
      });
  }

  private _renderRow(ch: ChannelEntry): string {
    return `
      <div class="channel-row" role="button" tabindex="0" aria-label="${escapeHtml(`${ch.channelName} — ${ch.hubName}`)}" data-entity="${escapeHtml(ch.entityId)}">
        <div class="channel-icon ${ch.active ? "active" : "inactive"}"><ha-icon icon="mdi:message-text"></ha-icon></div>
        <div class="channel-info">
          <div class="channel-name">${escapeHtml(ch.channelName)}</div>
          <div class="channel-hub">${escapeHtml(ch.hubName)}</div>
        </div>
        <span class="channel-dot ${ch.active ? "active" : "inactive"}" aria-hidden="true"></span>
      </div>`;
  }

  private _render(): void {
    if (!this._hass || !this._config) return;
    const t = makeLocalize(this._hass.language ?? this._hass.locale?.language ?? "en");
    const channels = this._discoverChannels();
    if (!channels.length) {
      this._setBody(`<div class="empty">${t("card.empty_channels")}</div>`);
      return;
    }
    this._setBody(
      `<div class="section-label">${t("card.section_channels")}</div>` +
      `<div class="channel-list">${channels.map((ch) => this._renderRow(ch)).join("")}</div>`
    );
  }

  private _setBody(body: string): void {
    const constrained = typeof this._config?.grid_options?.rows === "number";
    const cls = constrained ? " class=\"grid-rows\"" : "";
    this.shadowRoot!.innerHTML = `<style>${STYLES}${CHANNEL_STYLES}</style><ha-card${cls}>${body}</ha-card>`;
    if (constrained) this._scheduleTrim(".channel-row");
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
    return 3;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("mushroom-meshcore-channel-card-editor");
  }

  static getStubConfig(): MeshcoreChannelCardConfig {
    return {};
  }
}

export class MeshcoreChannelCardEditor extends HTMLElement {
  private _config?: MeshcoreChannelCardConfig;

  setConfig(config: MeshcoreChannelCardConfig): void {
    this._config = { ...config };
  }

  set hass(_hass: HomeAssistant) {
    // no entity pickers needed — channel card has no user-configurable entities
  }

  connectedCallback(): void {
    // Editor has no controls; all discovery is automatic.
    while (this.lastChild) this.removeChild(this.lastChild);
    const msg = document.createElement("p");
    msg.style.cssText = "margin: 16px; color: var(--secondary-text-color); font-size: 14px;";
    msg.textContent = "Channels are discovered automatically from the MeshCore integration.";
    this.appendChild(msg);
  }
}
