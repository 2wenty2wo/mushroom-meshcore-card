export const STYLES: string = `
  *, *::before, *::after { box-sizing: border-box; }

  :host {
    --mushroom-meshcore-primary-font-size: var(--mush-card-primary-font-size, 14px);
    --mushroom-meshcore-secondary-font-size: var(--mush-card-secondary-font-size, 12px);
    --mushroom-meshcore-primary-font-weight: var(--mush-card-primary-font-weight, 500);
    --mushroom-meshcore-secondary-font-weight: var(--mush-card-secondary-font-weight, 400);
    --mushroom-meshcore-chip-height: var(--mush-chip-height, 32px);
    --mushroom-meshcore-chip-radius: var(--mush-chip-border-radius, 18px);
    --mushroom-meshcore-chip-spacing: var(--mush-chip-spacing, 8px);
    --mushroom-meshcore-icon-size: var(--mush-icon-size, 42px);
    --mushroom-meshcore-icon-radius: var(--mush-icon-border-radius, 50%);
    --mushroom-meshcore-card-background: var(--ha-card-background, var(--card-background-color, #fff));
    --mushroom-meshcore-surface: var(--mush-chip-background, var(--secondary-background-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.045)));
    --mushroom-meshcore-border-color: var(--ha-card-border-color, var(--divider-color, rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12)));
    --mushroom-meshcore-success-color: var(--success-color, rgb(var(--rgb-success, 76, 175, 80)));
    --mushroom-meshcore-warning-color: var(--warning-color, rgb(var(--rgb-warning, 255, 152, 0)));
    --mushroom-meshcore-danger-color: var(--error-color, rgb(var(--rgb-danger, 244, 67, 54)));
    --mushroom-meshcore-info-color: var(--info-color, var(--primary-color, #03a9f4));
    --mushroom-meshcore-muted-color: var(--secondary-text-color, #727272);
    --mushroom-meshcore-node-radius: var(--ha-card-border-radius, 16px);
    --mushroom-meshcore-card-padding: 12px;
    --mushroom-meshcore-node-spacing: 10px;

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
  .clickable:active { transform: scale(0.98); }

  .section-label {
    padding: 4px 4px 8px;
    color: var(--secondary-text-color, #727272);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .nodes-section { margin-top: 10px; }

  .node-block {
    padding: 14px;
    margin: 0 0 var(--mushroom-meshcore-node-spacing);
    overflow: hidden;
    border: var(--ha-card-border-width, 1px) solid var(--mushroom-meshcore-border-color);
    border-radius: var(--mushroom-meshcore-node-radius);
    background: var(--mushroom-meshcore-surface);
    box-shadow: none;
  }

  .node-block:last-child { margin-bottom: 0; }

  /* Mushroom-style remote-node header. */
  .node-card-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }

  .node-icon-shape {
    display: inline-flex;
    width: var(--mushroom-meshcore-icon-size);
    height: var(--mushroom-meshcore-icon-size);
    flex: 0 0 var(--mushroom-meshcore-icon-size);
    align-items: center;
    justify-content: center;
    border-radius: var(--mushroom-meshcore-icon-radius);
    color: var(--mushroom-meshcore-success-color);
    background: rgba(var(--rgb-success, 76, 175, 80), 0.16);
  }

  .node-icon-shape ha-icon {
    --mdc-icon-size: calc(var(--mushroom-meshcore-icon-size) * 0.55);
  }

  .node-offline .node-icon-shape {
    color: var(--mushroom-meshcore-muted-color);
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
  }

  .node-heading { min-width: 0; }

  .node-name {
    overflow: hidden;
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-secondary {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .separator { opacity: 0.65; }

  .node-badges {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .status-pill,
  .type-badge,
  .count-badge,
  .node-header-badge,
  .badge,
  .rf-chip,
  .mqtt-pill {
    display: inline-flex;
    min-height: 24px;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid var(--mushroom-meshcore-border-color);
    border-radius: 999px;
    background: var(--mushroom-meshcore-card-background);
    color: var(--secondary-text-color, #727272);
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }

  .status-pill.online { color: var(--mushroom-meshcore-success-color); }
  .status-pill.offline { color: var(--mushroom-meshcore-danger-color); }

  .status-pill .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .type-badge { color: var(--mushroom-meshcore-info-color); }

  /* Core metrics. */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
    gap: 8px;
    margin-top: 14px;
  }

  .node-metric {
    display: flex;
    min-height: 54px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--mushroom-meshcore-card-background);
    text-align: left;
  }

  .metric-label {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    line-height: 16px;
  }

  .metric-value {
    color: var(--primary-text-color, #212121);
    font-size: 15px;
    font-weight: 600;
    line-height: 20px;
    white-space: nowrap;
  }

  .metric-unit {
    color: var(--secondary-text-color, #727272);
    font-size: 11px;
    font-weight: 400;
  }

  /* Battery stays informative without becoming the visual focus. */
  .battery-block { margin-top: 11px; }

  .battery-meta,
  .bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 5px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
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
    border-radius: 999px;
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.12);
  }

  .bar-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--bar-color, var(--mushroom-meshcore-success-color));
    transition: width 0.3s ease;
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

  .quick-chip-row { margin-top: 11px; }

  .quick-chip,
  .chip,
  .loc-coords,
  .map-link {
    display: inline-flex;
    min-height: var(--mushroom-meshcore-chip-height);
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 11px;
    border: 1px solid var(--mushroom-meshcore-border-color);
    border-radius: var(--mushroom-meshcore-chip-radius);
    background: var(--mushroom-meshcore-card-background);
    color: var(--primary-text-color, #212121);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
  }

  .quick-chip ha-icon,
  .loc-coords ha-icon {
    --mdc-icon-size: 16px;
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
    min-height: 36px;
    align-items: center;
    justify-content: space-between;
    padding: 7px 2px 0;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    list-style: none;
    cursor: pointer;
  }

  .node-details summary::-webkit-details-marker { display: none; }
  .node-details summary ha-icon {
    --mdc-icon-size: 18px;
    transition: transform 0.2s ease;
  }
  .node-details[open] summary ha-icon { transform: rotate(180deg); }

  .details-content { padding-top: 3px; }

  .detail-section { margin-top: 12px; }
  .detail-section h4,
  .section-header,
  .neighbors-header {
    margin: 0 0 7px;
    color: var(--secondary-text-color, #727272);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    line-height: 14px;
    text-transform: uppercase;
  }

  /* Retained hub presentation, now using the shared tokens. */
  .node-header,
  .node-left,
  .node-right,
  .node-title-row {
    display: flex;
    align-items: center;
  }

  .node-header { justify-content: space-between; gap: 10px; }
  .node-left, .node-right { gap: 8px; flex-wrap: wrap; }
  .node-title-row { gap: 8px; flex-wrap: wrap; margin: 7px 0 5px; }

  .node-header > .node-left > .status-dot,
  .contact-right .status-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .dot-online { background: var(--mushroom-meshcore-success-color); }
  .dot-offline { background: var(--mushroom-meshcore-muted-color); opacity: 0.55; }
  .status-text { font-size: var(--mushroom-meshcore-secondary-font-size); font-weight: 600; }
  .status-text.online { color: var(--mushroom-meshcore-success-color); }
  .status-text.offline { color: var(--mushroom-meshcore-muted-color); }

  .hub-name { font-weight: var(--mushroom-meshcore-primary-font-weight); }
  .hw-info {
    margin: 3px 0 6px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
  }
  .node-key {
    overflow-wrap: anywhere;
    font-family: var(--code-font-family, monospace);
    font-size: 11px;
  }
  .dim { color: var(--secondary-text-color, #727272); opacity: 0.7; }
  .rf-row, .mqtt-row, .chip-row { margin: 6px 0; }
  .rf-chip { min-height: 28px; }
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
    padding: 9px 10px;
    border-radius: 12px;
    background: var(--mushroom-meshcore-card-background);
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
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .neighbor-snr {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--mushroom-meshcore-surface);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .neighbor-snr ha-icon { --mdc-icon-size: 14px; }
  .neighbor-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 5px;
    color: var(--secondary-text-color, #727272);
    font-size: 10px;
  }
  .green { color: var(--mushroom-meshcore-success-color); }
  .yellow, .orange { color: var(--mushroom-meshcore-warning-color); }
  .red { color: var(--mushroom-meshcore-danger-color); }
  .blue { color: var(--mushroom-meshcore-info-color); }

  .empty {
    padding: 24px 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    line-height: 1.6;
    text-align: center;
  }

  ha-card.grid-rows { height: 100%; overflow: hidden; }

  @media (max-width: 420px) {
    .node-card-header { grid-template-columns: auto minmax(0, 1fr); }
    .node-badges { grid-column: 2; justify-content: flex-start; }
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
