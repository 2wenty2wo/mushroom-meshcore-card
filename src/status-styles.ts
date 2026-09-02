import { STYLES } from "./styles.js";

export const STATUS_CARD_STYLES = `${STYLES}
  ha-card.status-card {
    display: flex;
    min-height: 112px;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }

  ha-card.status-card.grid-rows { height: 100%; }

  .status-card.grid-rows .status-body {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .status-body {
    padding: 0 var(--mush-spacing, 10px) var(--mush-spacing, 10px);
  }

  .status-card.status-warning .device-icon-shape {
    background: rgba(var(--mush-rgb-warning, var(--rgb-warning, 255, 152, 0)), 0.2);
  }

  .status-card.status-warning .device-icon-shape ha-tile-icon {
    --tile-icon-color: var(--mushroom-meshcore-warning-color);
  }

  .status-card.status-critical .device-icon-shape {
    background: rgba(var(--mush-rgb-danger, var(--rgb-danger, 244, 67, 54)), 0.2);
  }

  .status-card.status-critical .device-icon-shape ha-tile-icon {
    --tile-icon-color: var(--mushroom-meshcore-danger-color);
  }

  .status-card.status-unknown .device-icon-shape {
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
  }

  .status-card.status-unknown .device-icon-shape ha-tile-icon {
    --tile-icon-color: var(--mushroom-meshcore-muted-color);
  }

  .status-calm {
    display: flex;
    min-height: var(--mushroom-meshcore-control-height);
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 0 var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .status-calm ha-icon {
    color: var(--mushroom-meshcore-success-color);
    --mdc-icon-size: 20px;
  }

  .status-findings { margin-top: var(--mush-spacing, 10px); }

  .status-issue-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .status-group-title {
    margin: 0 0 6px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }

  .status-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .status-issue-disclosure {
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
    overflow: hidden;
  }

  .status-issue-disclosure > summary {
    display: flex;
    min-height: var(--mushroom-meshcore-control-height);
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 3px var(--mush-spacing, 10px);
    list-style: none;
    cursor: pointer;
  }

  .status-issue-disclosure > summary::-webkit-details-marker { display: none; }
  .status-issue-disclosure.warning > summary .status-row-icon {
    color: var(--mushroom-meshcore-warning-color);
  }
  .status-issue-disclosure.critical > summary .status-row-icon {
    color: var(--mushroom-meshcore-danger-color);
  }
  .status-issue-disclosure > .status-list {
    padding: 0 6px 6px;
  }
  .status-disclosure-chevron {
    flex: 0 0 auto;
    color: var(--secondary-text-color, #727272);
    transition: transform 180ms ease-in-out;
    --mdc-icon-size: 18px;
  }
  .status-issue-disclosure[open] > summary .status-disclosure-chevron {
    transform: rotate(180deg);
  }

  .status-row {
    position: relative;
    display: flex;
    width: 100%;
    min-height: var(--mushroom-meshcore-control-height);
    align-items: center;
    gap: var(--mush-spacing, 10px);
    padding: 3px var(--mush-spacing, 10px);
    border-radius: var(--mushroom-meshcore-control-radius);
    background: var(--mushroom-meshcore-surface);
    text-align: left;
  }

  .status-row-icon {
    display: inline-flex;
    width: var(--mushroom-meshcore-icon-size);
    height: var(--mushroom-meshcore-icon-size);
    flex: 0 0 var(--mushroom-meshcore-icon-size);
    align-items: center;
    justify-content: center;
    border-radius: var(--mushroom-meshcore-icon-radius);
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
    color: var(--mushroom-meshcore-muted-color);
    font-size: var(--mushroom-meshcore-icon-size);
  }

  .status-row-icon ha-icon {
    --mdc-icon-size: var(--mushroom-meshcore-icon-symbol-size);
  }
  .status-row.warning .status-row-icon {
    background: rgba(var(--mush-rgb-warning, var(--rgb-warning, 255, 152, 0)), 0.2);
    color: var(--mushroom-meshcore-warning-color);
  }
  .status-row.critical .status-row-icon {
    background: rgba(var(--mush-rgb-danger, var(--rgb-danger, 244, 67, 54)), 0.2);
    color: var(--mushroom-meshcore-danger-color);
  }
  .status-row.healthy .status-row-icon {
    background: rgba(var(--mush-rgb-success, var(--rgb-success, 76, 175, 80)), 0.2);
    color: var(--mushroom-meshcore-success-color);
  }

  .status-row-copy { min-width: 0; flex: 1; }
  .status-row-primary,
  .status-row-secondary {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-row-primary {
    font-size: var(--mushroom-meshcore-primary-font-size);
    font-weight: var(--mushroom-meshcore-primary-font-weight);
    letter-spacing: var(--mushroom-meshcore-primary-letter-spacing);
    line-height: var(--mushroom-meshcore-primary-line-height);
    white-space: nowrap;
  }
  .status-row-secondary {
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: var(--mushroom-meshcore-secondary-font-weight);
    letter-spacing: var(--mushroom-meshcore-secondary-letter-spacing);
    line-height: var(--mushroom-meshcore-secondary-line-height);
  }
  .status-row > ha-icon:last-child {
    color: var(--secondary-text-color, #727272);
    --mdc-icon-size: 18px;
  }

  .status-disclosure {
    margin: var(--mush-spacing, 10px) calc(-1 * var(--mush-spacing, 10px)) calc(-1 * var(--mush-spacing, 10px));
    border-top: 1px solid var(--mushroom-meshcore-border-color);
  }

  .status-disclosure + .status-disclosure { margin-top: 0; }

  .status-disclosure summary {
    display: flex;
    min-height: var(--mushroom-meshcore-control-height);
    align-items: center;
    justify-content: space-between;
    padding: 0 calc(var(--mush-spacing, 10px) + 2px);
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    font-weight: 500;
    list-style: none;
    cursor: pointer;
  }

  .status-disclosure summary::-webkit-details-marker { display: none; }
  .status-disclosure summary ha-icon {
    transition: transform 180ms ease-in-out;
    --mdc-icon-size: 18px;
  }
  .status-disclosure[open] summary ha-icon { transform: rotate(180deg); }
  .status-disclosure-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 3px var(--mush-spacing, 10px) var(--mush-spacing, 10px);
  }

  .empty-status {
    padding: 24px 16px;
    color: var(--secondary-text-color, #727272);
    font-size: var(--mushroom-meshcore-secondary-font-size);
    text-align: center;
  }
`;
