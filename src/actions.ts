import type { ActionConfig, HomeAssistant } from "./types.js";

/** Execute a Mushroom/Tile-style action config. `entityId` backs the
 *  default `more-info` action. Dispatches from `node` so `hass-more-info`
 *  bubbles through the card into the HA frontend. */
export function handleAction(
  node: HTMLElement,
  hass: HomeAssistant | undefined,
  action: ActionConfig | undefined,
  entityId: string | null
): void {
  const config = action ?? { action: "more-info" };
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
