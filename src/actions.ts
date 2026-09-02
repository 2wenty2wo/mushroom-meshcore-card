import type { ActionConfig, HomeAssistant } from "./types.js";

/** Execute a Mushroom/Tile-style action config. `entityId` backs the
 *  default `more-info` action. Dispatches from `node` so `hass-more-info`
 *  bubbles through the card into the HA frontend. Honors the standard
 *  `confirmation:` option before any side effect, mirroring HA's action
 *  handler; `confirmText` supplies the localized fallback prompt. */
export function handleAction(
  node: HTMLElement,
  hass: HomeAssistant | undefined,
  action: ActionConfig | undefined,
  entityId: string | null,
  confirmText = "Are you sure?"
): void {
  const config = action ?? { action: "more-info" };
  if (config.confirmation && config.action !== "none") {
    const text =
      typeof config.confirmation === "object" && config.confirmation.text
        ? config.confirmation.text
        : confirmText;
    if (!window.confirm(text)) return;
  }
  switch (config.action) {
    case "more-info": {
      if (!entityId) return;
      const event = new Event("hass-more-info", { bubbles: true, composed: true });
      (event as Event & { detail: { entityId: string } }).detail = { entityId };
      node.dispatchEvent(event);
      return;
    }
    case "navigate": {
      if (!config.navigation_path) return;
      history.pushState(null, "", config.navigation_path);
      window.dispatchEvent(
        new Event("location-changed", { bubbles: true, composed: true })
      );
      return;
    }
    case "url": {
      if (config.url_path) window.open(config.url_path);
      return;
    }
    case "perform-action":
    case "call-service": {
      const serviceCall = config.perform_action ?? config.service;
      if (!serviceCall || !hass?.callService) return;
      const [domain, service] = serviceCall.split(".", 2);
      if (!domain || !service) return;
      void hass.callService(
        domain,
        service,
        config.data ?? config.service_data,
        config.target
      );
      return;
    }
    case "none":
    default:
      return;
  }
}

/** True when the config carries a real action (used to decide whether the
 *  hold/double-tap gesture machinery needs to run for a card). */
export function hasAction(action: ActionConfig | undefined): boolean {
  return !!action && action.action !== "none";
}

export interface HeaderActionConfig {
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

/** Shared Mushroom/Tile gesture handling for elements marked with
 *  `data-action-scope`. Hosts keep their own delegated click listeners and
 *  call these methods before handling entity-specific controls. */
export class HeaderActionController {
  private _holdTimer: ReturnType<typeof setTimeout> | null = null;
  private _holdFired = false;
  private _tapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly _node: HTMLElement,
    private readonly _getHass: () => HomeAssistant | undefined,
    private readonly _getConfig: () => HeaderActionConfig | undefined,
    private readonly _getConfirmText: () => string,
    /** Optional surface-specific default used only when tap_action is absent.
     * Existing Tile headers omit it and retain the standard more-info default. */
    private readonly _onDefaultTap?: (entityId: string | null) => void
  ) {}

  private _performTap(action: ActionConfig | undefined, entityId: string | null): void {
    if (action === undefined && this._onDefaultTap) {
      this._onDefaultTap(entityId);
      return;
    }
    handleAction(
      this._node,
      this._getHass(),
      action,
      entityId,
      this._getConfirmText()
    );
  }

  handleClick(event: Event): boolean {
    const header = (event.target as Element).closest?.(
      "[data-action-scope]"
    ) as HTMLElement | null;
    if (!header) return false;

    if (this._holdFired) {
      this._holdFired = false;
      return true;
    }

    const entityId = header.dataset["entity"] ?? null;
    const config = this._getConfig();
    const doubleTap = config?.double_tap_action;
    if (hasAction(doubleTap)) {
      if (this._tapTimer !== null) {
        clearTimeout(this._tapTimer);
        this._tapTimer = null;
        handleAction(
          this._node,
          this._getHass(),
          doubleTap,
          entityId,
          this._getConfirmText()
        );
      } else {
        this._tapTimer = setTimeout(() => {
          this._tapTimer = null;
          this._performTap(this._getConfig()?.tap_action, entityId);
        }, 250);
      }
      return true;
    }

    this._performTap(config?.tap_action, entityId);
    return true;
  }

  handlePointerDown(event: Event): void {
    const config = this._getConfig();
    if (!hasAction(config?.hold_action)) return;
    const header = (event.target as Element).closest?.(
      "[data-action-scope]"
    ) as HTMLElement | null;
    if (!header) return;

    this._holdFired = false;
    this._clearHoldTimer();
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this._holdFired = true;
      handleAction(
        this._node,
        this._getHass(),
        this._getConfig()?.hold_action,
        header.dataset["entity"] ?? null,
        this._getConfirmText()
      );
    }, 500);
  }

  handlePointerEnd(): void {
    this._clearHoldTimer();
  }

  disconnect(): void {
    this._clearHoldTimer();
    if (this._tapTimer !== null) {
      clearTimeout(this._tapTimer);
      this._tapTimer = null;
    }
  }

  private _clearHoldTimer(): void {
    if (this._holdTimer !== null) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
  }
}
