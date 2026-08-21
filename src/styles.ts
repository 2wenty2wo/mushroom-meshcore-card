export const STYLES: string = `
  *, *::before, *::after { box-sizing: border-box; }

  :host {
    --mushroom-meshcore-primary-font-size: var(--mush-card-primary-font-size, 14px);
    --mushroom-meshcore-secondary-font-size: var(--mush-card-secondary-font-size, 12px);
    --mushroom-meshcore-primary-font-weight: var(--mush-card-primary-font-weight, 500);
    --mushroom-meshcore-secondary-font-weight: var(--mush-card-secondary-font-weight, 400);
    --mushroom-meshcore-primary-line-height: var(--mush-card-primary-line-height, 20px);
    --mushroom-meshcore-secondary-line-height: var(--mush-card-secondary-line-height, 16px);
    --mushroom-meshcore-primary-letter-spacing: var(--mush-card-primary-letter-spacing, 0.1px);
    --mushroom-meshcore-secondary-letter-spacing: var(--mush-card-secondary-letter-spacing, 0.4px);
    --mushroom-meshcore-chip-height: var(--mush-chip-height, 36px);
    --mushroom-meshcore-chip-radius: var(--mush-chip-border-radius, 19px);
    --mushroom-meshcore-chip-spacing: var(--mush-chip-spacing, 8px);
    --mushroom-meshcore-chip-background: var(--mush-chip-background, var(--ha-card-background, var(--card-background-color, white)));
    --mushroom-meshcore-chip-border-width: var(--mush-chip-border-width, var(--ha-card-border-width, 1px));
    --mushroom-meshcore-chip-border-color: var(--mush-chip-border-color, var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12))));
    --mushroom-meshcore-icon-size: var(--mush-icon-size, 36px);
    --mushroom-meshcore-icon-symbol-size: var(--mush-icon-symbol-size, 0.667em);
    --mushroom-meshcore-icon-radius: var(--mush-icon-border-radius, 50%);
    --mushroom-meshcore-control-height: var(--mush-control-height, 42px);
    --mushroom-meshcore-control-radius: var(--mush-control-border-radius, 12px);
    --mushroom-meshcore-badge-size: var(--mush-badge-size, 16px);
    --mushroom-meshcore-badge-radius: var(--mush-badge-border-radius, 50%);
    --mushroom-meshcore-card-background: var(--ha-card-background, var(--card-background-color, white));
    --mushroom-meshcore-surface: var(--secondary-background-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05));
    --mushroom-meshcore-border-color: var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
    --mushroom-meshcore-success-color: var(--success-color, rgb(var(--mush-rgb-success, var(--rgb-success, 76, 175, 80))));
    --mushroom-meshcore-warning-color: var(--warning-color, rgb(var(--mush-rgb-warning, var(--rgb-warning, 255, 152, 0))));
    --mushroom-meshcore-danger-color: var(--error-color, rgb(var(--mush-rgb-danger, var(--rgb-danger, 244, 67, 54))));
    --mushroom-meshcore-info-color: var(--info-color, rgb(var(--mush-rgb-info, var(--rgb-info, 3, 169, 244))));
    --mushroom-meshcore-muted-color: var(--secondary-text-color, #727272);
    --mushroom-meshcore-card-padding: var(--mush-spacing, 10px);

    /* Compatibility aliases for the retained hub/contact/channel layouts. */
    --mesh-green: var(--mushroom-meshcore-success-color);
    --mesh-blue: var(--mushroom-meshcore-info-color);
    --mesh-orange: var(--mushroom-meshcore-warning-color);
    --mesh-red: var(--mushroom-meshcore-danger-color);
    --mesh-purple: var(--mushroom-meshcore-info-color);
    --glass-border: var(--mushroom-meshcore-border-color);
    --glass-shadow: none;
    --glass-shadow-hover: none;
  }

  ha-card {
    display: block;
    padding: var(--mushroom-meshcore-card-padding);
    font-family: var(--primary-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif);
    font-size: var(--mushroom-meshcore-primary-font-size);
    color: var(--primary-text-color, #212121);
    background: var(--mushroom-meshcore-card-background);
    border-radius: var(--ha-card-border-radius, 12px);
  }

  ha-card.device-card { padding: 0; }

  button {
    min-width: 0;
    margin: 0;
    border: 0;
    font: inherit;
    color: inherit;
    appearance: none;
  }

  button:focus-visible,
  summary:focus-visible,
  a:focus-visible,
  [data-entity]:focus-visible {
    outline: 2px solid var(--primary-color, var(--mushroom-meshcore-info-color));
    outline-offset: 2px;
  }

  .clickable { cursor: pointer; }
  .clickable:hover { filter: brightness(0.97); }
  .clickable:active { filter: brightness(0.94); }

  .section-label {
    padding: 0 0 8px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  /* Native Tile header shared by hub and node cards. */
  .device-header-row {
    display: flex;
    min-height: 56px;
    align-items: center;
    padding: 0 var(--mush-spacing, 10px);
  }

  .device-header {
    display: flex;
    min-width: 0;
    min-height: 56px;
    flex: 1;
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 0;
    background: transparent;
    text-align: left;
  }

  .device-icon-shape {
    display: inline-flex;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    align-items: center;
    justify-content: center;
    border-radius: var(--ha-tile-icon-border-radius, var(--ha-border-radius-pill, 50%));
    background: rgba(var(--mush-rgb-success, var(--rgb-success, 76, 175, 80)), 0.2);
  }

  .device-icon-shape ha-tile-icon {
    --tile-icon-color: var(--mushroom-meshcore-success-color);
    flex: 0 0 36px;
  }

  .device-header-row.offline .device-icon-shape {
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
  }

  .device-header-row.offline .device-icon-shape ha-tile-icon {
    --tile-icon-color: var(--mushroom-meshcore-muted-color);
  }

  /* Progressive fallback while Home Assistant upgrades the custom elements. */
  .device-icon-shape ha-tile-icon:not(:defined) {
    display: inline-flex;
    width: 36px;
    height: 36px;
    align-items: center;
    justify-content: center;
    color: var(--tile-icon-color);
  }

  .device-icon-shape ha-tile-icon > ha-icon {
    display: flex;
    line-height: 0;
    --mdc-icon-size: 24px;
  }

  .device-header ha-tile-info {
    display: block;
    min-width: 0;
    flex: 1;
  }

  .device-header ha-tile-info > [slot="primary"],
  .device-header ha-tile-info > [slot="secondary"] {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-header ha-tile-info > [slot="primary"] {
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
  }

  .device-header ha-tile-info > [slot="secondary"] {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .device-body { padding: 0 var(--mush-spacing, 10px) var(--mush-spacing, 10px); }

  .type-badge,
  .count-badge,
  .node-header-badge,
  .badge,
  .rf-chip,
  .mqtt-pill {
    display: inline-flex;
    height: var(--mushroom-meshcore-chip-height);
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: var(--mushroom-meshcore-chip-border-width) solid var(--mushroom-meshcore-chip-border-color);
    border-radius: var(--mushroom-meshcore-chip-radius);
    background: var(--mushroom-meshcore-chip-background);
    color: var(--secondary-text-color, #727272);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .type-badge { color: var(--mushroom-meshcore-info-color); }

  /* Core metrics. */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
    gap: 8px;
    margin-top: var(--mush-spacing, 10px);
  }

  .node-metric {
    display: flex;
    min-height: 56px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    padding: var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
    text-align: left;
  }

  .metric-label {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .metric-value {
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    white-space: nowrap;
  }

  .metric-unit {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
  }

  /* Battery stays informative without becoming the visual focus. */
  .battery-block { margin-top: var(--mush-spacing, 10px); }

  .battery-meta,
  .bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 5px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .battery-voltage {
    padding: 2px 0;
    background: transparent;
    color: var(--secondary-text-color, #727272);
    font-size: inherit;
  }

  .bar-label-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bar-val { font-weight: 600; }

  .bar-track {
    width: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: calc(6px / 2);
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
  }

  .bar-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--bar-color, var(--mushroom-meshcore-success-color));
    transition: width 280ms ease-out;
  }

  /* Compact secondary facts. */
  .quick-chip-row,
  .chip-row,
  .node-chip-row,
  .detail-chips,
  .rf-row,
  .mqtt-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--mushroom-meshcore-chip-spacing);
  }

  .quick-chip-row { margin-top: var(--mush-spacing, 10px); }

  .quick-chip,
  .chip,
  .loc-coords,
  .map-link {
    display: inline-flex;
    height: var(--mushroom-meshcore-chip-height);
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 9px;
    border: var(--mushroom-meshcore-chip-border-width) solid var(--mushroom-meshcore-chip-border-color);
    border-radius: var(--mushroom-meshcore-chip-radius);
    background: var(--mushroom-meshcore-chip-background);
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 700;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
  }

  .quick-chip ha-icon,
  .loc-coords ha-icon {
    --mdc-icon-size: calc(var(--mushroom-meshcore-chip-height) * 0.5);
    color: var(--secondary-text-color, #727272);
  }

  .chip-label {
    color: var(--secondary-text-color, #727272);
    font-weight: 400;
  }

  /* Details remain collapsed until explicitly requested. */
  .node-details {
    margin-top: 10px;
    border-top: 1px solid var(--mushroom-meshcore-border-color);
  }

  .node-details summary {
    display: flex;
    height: var(--mushroom-meshcore-control-height);
    align-items: center;
    justify-content: space-between;
    padding: 0 2px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    list-style: none;
    cursor: pointer;
  }

  .node-details summary::-webkit-details-marker { display: none; }
  .node-details summary ha-icon {
    --mdc-icon-size: 18px;
    transition: transform 280ms ease-out;
  }
  .node-details[open] summary ha-icon { transform: rotate(180deg); }

  .details-content { padding-top: 3px; }

  .detail-section { margin-top: 12px; }
  .detail-section h4,
  .section-header,
  .neighbors-header {
    margin: 0 0 8px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  /* Retained contact-card status primitive. */
  .contact-right .status-dot {
    display: inline-block;
    width: var(--mushroom-meshcore-badge-size);
    height: var(--mushroom-meshcore-badge-size);
    border-radius: var(--mushroom-meshcore-badge-radius);
  }

  .dot-online { background: var(--mushroom-meshcore-success-color); }
  .dot-offline { background: var(--mushroom-meshcore-muted-color); opacity: 0.55; }
  .hw-info {
    margin: 0 0 8px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }
  .inline-entity {
    padding: 0;
    background: transparent;
    color: inherit;
  }
  .dim { color: var(--secondary-text-color, #727272); opacity: 0.7; }
  .rf-row, .mqtt-row, .chip-row { margin: 8px 0; }
  .mqtt-pill.ok { color: var(--mushroom-meshcore-success-color); }
  .mqtt-pill.err { color: var(--mushroom-meshcore-danger-color); }

  .loc-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .map-link { color: var(--mushroom-meshcore-info-color); }

  /* Neighbours live inside the node disclosure. */
  .neighbors-section { margin-top: 12px; }
  .neighbors-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .neighbors-list { display: flex; flex-direction: column; gap: 6px; }
  .neighbor-row {
    padding: var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
  }
  .neighbor-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .neighbor-name {
    overflow: hidden;
    padding: 0;
    background: transparent;
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .neighbor-snr {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--mushroom-meshcore-chip-height);
    padding: 0 9px;
    border-radius: var(--mushroom-meshcore-chip-radius);
    background: var(--mushroom-meshcore-surface);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    white-space: nowrap;
  }
  .neighbor-snr ha-icon { --mdc-icon-size: 14px; }
  .neighbor-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 5px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }
  .green { color: var(--mushroom-meshcore-success-color); }
  .yellow, .orange { color: var(--mushroom-meshcore-warning-color); }
  .red { color: var(--mushroom-meshcore-danger-color); }
  .blue { color: var(--mushroom-meshcore-info-color); }

  .empty {
    padding: 24px 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
    text-align: center;
  }

  ha-card.grid-rows { height: 100%; overflow: hidden; }

  @media (max-width: 420px) {
    .device-header-row { align-items: flex-start; padding-top: 10px; padding-bottom: 10px; }
    .device-header { min-height: 36px; }
    .device-header-row > .count-badge { height: 32px; padding: 0 7px; }
    .metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .node-metric { padding: 7px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
`;
