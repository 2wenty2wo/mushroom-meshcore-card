import { escapeHtml } from "./helpers.js";
import type { LocalizeFunc } from "./localize.js";

export interface NeighborInfo {
  id: string;
  name: string;
  contactEntityId: string | null;
  snr: number;
  snrId: string;
  secondsAgo: number | null;
  seenCount: number | null;
  seenId: string | null;
}

export interface NeighborSnapshot {
  supported: boolean;
  countEntityId: string | null;
  neighbors: NeighborInfo[];
}

function formatNeighborAge(secondsAgo: number): string {
  const diff = Math.max(0, secondsAgo);
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/**
 * Render the complete neighbours section used by the neighbours dialog.
 * Every external or translated value is escaped before entering the returned
 * HTML string.
 */
export function renderNeighborSection(
  snapshot: NeighborSnapshot,
  t: LocalizeFunc,
  maxNeighbors?: number
): string {
  if (!snapshot.supported) return "";

  const neighbors = snapshot.neighbors;
  const neighborsLabel = t("card.neighbors_label");
  const count = neighbors.length;
  const sectionStart = `<section class="neighbors-section" aria-label="${escapeHtml(neighborsLabel)}">
    <div class="neighbors-header">
      <span>${escapeHtml(neighborsLabel)}</span>
      <span class="count-badge">${escapeHtml(count)}</span>
    </div>`;

  if (count === 0) {
    return `${sectionStart}
      <div class="neighbors-empty" role="status">${escapeHtml(t("card.no_recent_neighbors"))}</div>
    </section>`;
  }

  const cap = typeof maxNeighbors === "number"
    && Number.isFinite(maxNeighbors)
    && maxNeighbors > 0
    ? Math.floor(maxNeighbors)
    : undefined;
  const shownNeighbors = cap === undefined ? neighbors : neighbors.slice(0, cap);
  const lastSeenLabel = t("card.neighbor_last_seen");
  const contactsLabel = t("card.neighbor_contacts");
  const snrLabel = t("card.snr_label");

  const rows = shownNeighbors.map((neighbor) => {
    const snr = neighbor.snr.toFixed(1);
    const timeString = neighbor.secondsAgo === null
      ? t("card.within_48h")
      : formatNeighborAge(neighbor.secondsAgo);
    const nameEntityId = neighbor.contactEntityId || neighbor.snrId;

    return `<div class="neighbor-row" role="listitem">
      <div class="neighbor-main">
        <button type="button" class="neighbor-name clickable" data-entity="${escapeHtml(nameEntityId)}" title="${escapeHtml(neighbor.name)}">${escapeHtml(neighbor.name)}</button>
        <button type="button" class="neighbor-snr clickable" data-entity="${escapeHtml(neighbor.snrId)}" aria-label="${escapeHtml(snrLabel)} ${escapeHtml(snr)} dB"><ha-ripple></ha-ripple><ha-icon icon="mdi:signal"></ha-icon>${escapeHtml(snr)} dB</button>
      </div>
      <div class="neighbor-stats">
        <span class="neighbor-stat"><ha-icon icon="mdi:clock-outline"></ha-icon>${escapeHtml(lastSeenLabel)}: ${escapeHtml(timeString)}</span>
        ${neighbor.seenCount !== null ? `<span class="neighbor-stat"><ha-icon icon="mdi:link-variant"></ha-icon>${escapeHtml(contactsLabel)}: ${escapeHtml(neighbor.seenCount)}x</span>` : ""}
      </div>
    </div>`;
  }).join("");

  return `${sectionStart}
    <div class="neighbors-list" role="list">
      ${rows}
    </div>
  </section>`;
}

/** Presentation for the neighbour list in the dialog. */
export const NEIGHBOR_STYLES = `
  .neighbors-section { margin-top: 12px; }
  .neighbors-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 8px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .count-badge {
    display: inline-flex;
    height: var(--mushroom-meshcore-chip-height, var(--mush-chip-height, 36px));
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: var(--mushroom-meshcore-chip-border-width, var(--mush-chip-border-width, var(--ha-card-border-width, 1px))) solid var(--mushroom-meshcore-chip-border-color, var(--mush-chip-border-color, var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)))));
    border-radius: var(--mushroom-meshcore-chip-radius, var(--mush-chip-border-radius, 19px));
    background: var(--mushroom-meshcore-chip-background, var(--mush-chip-background, var(--ha-card-background, var(--card-background-color, white))));
    color: var(--secondary-text-color, #727272);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .neighbors-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .neighbors-empty {
    padding: 8px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    text-align: center;
  }
  .neighbor-row {
    padding: var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius, var(--mush-control-border-radius, 12px));
    background: var(--mushroom-meshcore-surface, var(--secondary-background-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05)));
  }
  .neighbor-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .neighbor-name,
  .neighbor-snr {
    min-width: 0;
    margin: 0;
    border: 0;
    font: inherit;
    color: inherit;
    appearance: none;
    cursor: pointer;
  }
  .neighbor-name {
    position: relative;
    overflow: hidden;
    padding: 0;
    background: transparent;
    font-size: var(--mushroom-meshcore-primary-font-size, var(--mush-card-primary-font-size, 14px));
    font-weight: var(--mushroom-meshcore-primary-font-weight, var(--mush-card-primary-font-weight, 500));
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing, var(--mush-card-primary-letter-spacing, 0.1px));
    line-height: var(--mushroom-meshcore-primary-line-height, var(--mush-card-primary-line-height, 20px));
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .neighbor-snr {
    position: relative;
    display: inline-flex;
    overflow: hidden;
    height: var(--mushroom-meshcore-chip-height, var(--mush-chip-height, 36px));
    align-items: center;
    gap: 4px;
    padding: 0 9px;
    border-radius: var(--mushroom-meshcore-chip-radius, var(--mush-chip-border-radius, 19px));
    background: var(--mushroom-meshcore-surface, var(--secondary-background-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05)));
    font-size: 11px;
    font-weight: 700;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    white-space: nowrap;
  }
  .neighbor-name::after,
  .neighbor-snr::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    transition: opacity 180ms ease-in-out;
    pointer-events: none;
  }
  @media (hover: hover) {
    .neighbor-name:hover::after,
    .neighbor-snr:hover::after { opacity: 0.04; }
  }
  .neighbor-name:focus-visible,
  .neighbor-snr:focus-visible {
    outline: 2px solid var(--primary-color, var(--info-color, #03a9f4));
    outline-offset: 2px;
  }
  .neighbor-snr ha-icon { --mdc-icon-size: 14px; }
  ha-ripple { --ha-ripple-hover-opacity: 0; }
  .neighbor-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 5px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size, var(--mush-card-secondary-font-size, 12px));
    font-weight: var(--mushroom-meshcore-secondary-font-weight, var(--mush-card-secondary-font-weight, 400));
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing, var(--mush-card-secondary-letter-spacing, 0.4px));
    line-height: var(--mushroom-meshcore-secondary-line-height, var(--mush-card-secondary-line-height, 16px));
  }
  .neighbor-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .neighbor-stat ha-icon {
    display: flex;
    line-height: 0;
    --mdc-icon-size: 14px;
  }
  @media (prefers-reduced-motion: reduce) {
    .neighbor-name::after,
    .neighbor-snr::after { transition: none; }
  }
`;
