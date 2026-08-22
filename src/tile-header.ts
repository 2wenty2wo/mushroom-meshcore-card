import type { ActionConfig } from "./types.js";
import { hasAction } from "./actions.js";
import { computeCssColor, escapeHtml } from "./helpers.js";

export interface TileHeaderConfig {
  name?: string;
  icon?: string;
  icon_color?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface TileHeaderOptions {
  displayName: string;
  secondary: string;
  icon: string;
  active: boolean;
  primaryEntityId: string | null;
  trailing?: string;
  inactiveBadgeIcon?: string;
}

/** Render the native Tile header used across single-target MeshCore cards. */
export function renderTileHeader(
  config: TileHeaderConfig | undefined,
  options: TileHeaderOptions
): string {
  const name = config?.name || options.displayName;
  const iconName = config?.icon || options.icon;
  const stateClass = options.active ? "online" : "offline";
  const label = options.secondary ? `${name}, ${options.secondary}` : name;
  const interactive =
    !!options.primaryEntityId ||
    hasAction(config?.tap_action) ||
    hasAction(config?.hold_action) ||
    hasAction(config?.double_tap_action);
  const tag = interactive ? "button" : "div";
  const attributes = interactive
    ? `type="button" data-action-scope="header"${
        options.primaryEntityId
          ? ` data-entity="${escapeHtml(options.primaryEntityId)}"`
          : ""
      } aria-label="${escapeHtml(label)}"`
    : `role="group" aria-label="${escapeHtml(label)}"`;

  // icon_color only recolors an active target; unavailable/offline targets
  // retain the muted Tile treatment so their state stays legible.
  const colorCss =
    options.active && config?.icon_color
      ? computeCssColor(config.icon_color)
      : null;
  const shapeStyle = colorCss
    ? ` style="background:color-mix(in srgb, ${escapeHtml(
        colorCss
      )} 20%, transparent);--mushroom-meshcore-icon-override-color:${escapeHtml(
        colorCss
      )}"`
    : "";
  const badge = options.active
    ? ""
    : `<span class="icon-badge" aria-hidden="true"><ha-icon icon="${escapeHtml(
        options.inactiveBadgeIcon ?? "mdi:signal-off"
      )}"></ha-icon></span>`;

  return `<div class="device-header-row ${stateClass}" part="device-header">
    <${tag} class="device-header ${interactive ? "clickable" : ""}" ${attributes}>
      ${interactive ? "<ha-ripple></ha-ripple>" : ""}
      <span class="device-icon-shape" aria-hidden="true"${shapeStyle}>
        <ha-tile-icon>
          <ha-icon slot="icon" icon="${escapeHtml(iconName)}"></ha-icon>
        </ha-tile-icon>
        ${badge}
      </span>
      <ha-tile-info>
        <span slot="primary">${escapeHtml(name)}</span>
        ${
          options.secondary
            ? `<span slot="secondary">${escapeHtml(options.secondary)}</span>`
            : ""
        }
      </ha-tile-info>
    </${tag}>
    ${options.trailing ?? ""}
  </div>`;
}

/** `ha-tile-info` reads properties in current HA releases. Keep slotted text
 *  as a safe fallback while the custom element upgrades, then hydrate it. */
export function hydrateTileInfo(root: ShadowRoot): void {
  const applyProperties = (): void => {
    for (const info of Array.from(root.querySelectorAll("ha-tile-info"))) {
      const primary =
        info.querySelector<HTMLElement>('[slot="primary"]')?.textContent ?? "";
      const secondary =
        info.querySelector<HTMLElement>('[slot="secondary"]')?.textContent ?? "";
      const tileInfo = info as HTMLElement & {
        primary: string;
        secondary: string;
      };
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
