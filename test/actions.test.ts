import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderActionController, handleAction, hasAction } from "../src/actions.js";
import type { ActionConfig, HomeAssistant } from "../src/types.js";

function mockHass() {
  const callService = vi.fn();
  return { hass: { callService } as unknown as HomeAssistant, callService };
}

const serviceAction = (service: string, extra: Partial<ActionConfig> = {}): ActionConfig => ({
  action: "perform-action",
  perform_action: service,
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasAction", () => {
  it("is false for undefined and explicit none", () => {
    expect(hasAction(undefined)).toBe(false);
    expect(hasAction({ action: "none" })).toBe(false);
  });

  it("is true for any real action", () => {
    expect(hasAction({ action: "more-info" })).toBe(true);
    expect(hasAction({ action: "navigate", navigation_path: "/x" })).toBe(true);
  });
});

describe("handleAction", () => {
  it("defaults to more-info and dispatches a bubbling hass-more-info event", () => {
    const node = document.createElement("div");
    const seen: string[] = [];
    node.addEventListener("hass-more-info", (event) => {
      seen.push((event as Event & { detail: { entityId: string } }).detail.entityId);
    });
    handleAction(node, undefined, undefined, "sensor.primary");
    expect(seen).toEqual(["sensor.primary"]);
  });

  it("does nothing on more-info without an entity", () => {
    const node = document.createElement("div");
    const listener = vi.fn();
    node.addEventListener("hass-more-info", listener);
    handleAction(node, undefined, { action: "more-info" }, null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("navigate pushes history state and fires location-changed", () => {
    const push = vi.spyOn(history, "pushState").mockImplementation(() => {});
    const listener = vi.fn();
    window.addEventListener("location-changed", listener);
    handleAction(
      document.createElement("div"),
      undefined,
      { action: "navigate", navigation_path: "/lovelace/mesh" },
      null
    );
    window.removeEventListener("location-changed", listener);
    expect(push).toHaveBeenCalledWith(null, "", "/lovelace/mesh");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("navigate without a path is a no-op", () => {
    const push = vi.spyOn(history, "pushState").mockImplementation(() => {});
    handleAction(document.createElement("div"), undefined, { action: "navigate" }, null);
    expect(push).not.toHaveBeenCalled();
  });

  it("url opens the configured path", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    handleAction(
      document.createElement("div"),
      undefined,
      { action: "url", url_path: "https://example.com" },
      null
    );
    expect(open).toHaveBeenCalledWith("https://example.com");
  });

  it("perform-action calls the service with data and target", () => {
    const { hass, callService } = mockHass();
    handleAction(
      document.createElement("div"),
      hass,
      serviceAction("light.turn_on", {
        data: { brightness: 255 },
        target: { entity_id: "light.desk" },
      }),
      null
    );
    expect(callService).toHaveBeenCalledWith(
      "light",
      "turn_on",
      { brightness: 255 },
      { entity_id: "light.desk" }
    );
  });

  it("supports the legacy call-service form", () => {
    const { hass, callService } = mockHass();
    handleAction(
      document.createElement("div"),
      hass,
      { action: "call-service", service: "switch.toggle", service_data: { a: 1 } },
      null
    );
    expect(callService).toHaveBeenCalledWith("switch", "toggle", { a: 1 }, undefined);
  });

  it("ignores malformed service strings", () => {
    const { hass, callService } = mockHass();
    handleAction(
      document.createElement("div"),
      hass,
      { action: "perform-action", perform_action: "no-dot" },
      null
    );
    expect(callService).not.toHaveBeenCalled();
  });

  it("does nothing for action none, even with confirmation set", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { hass, callService } = mockHass();
    handleAction(
      document.createElement("div"),
      hass,
      { action: "none", confirmation: true },
      "sensor.x"
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  describe("confirmation", () => {
    it("blocks the action when declined", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { hass, callService } = mockHass();
      handleAction(
        document.createElement("div"),
        hass,
        serviceAction("light.toggle", { confirmation: true }),
        null
      );
      expect(callService).not.toHaveBeenCalled();
    });

    it("runs the action when accepted, using the localized fallback text", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const { hass, callService } = mockHass();
      handleAction(
        document.createElement("div"),
        hass,
        serviceAction("light.toggle", { confirmation: true }),
        null,
        "Vraiment ?"
      );
      expect(confirm).toHaveBeenCalledWith("Vraiment ?");
      expect(callService).toHaveBeenCalledTimes(1);
    });

    it("prefers the configured confirmation text", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      handleAction(
        document.createElement("div"),
        undefined,
        { action: "more-info", confirmation: { text: "Open it?" } },
        "sensor.x"
      );
      expect(confirm).toHaveBeenCalledWith("Open it?");
    });
  });
});

describe("HeaderActionController", () => {
  let host: HTMLElement;
  let header: HTMLElement;
  let config: {
    tap_action?: ActionConfig;
    hold_action?: ActionConfig;
    double_tap_action?: ActionConfig;
  };
  let callService: ReturnType<typeof vi.fn>;
  let controller: HeaderActionController;

  const clickEvent = (target: Element = header) => ({ target }) as unknown as Event;
  const calledServices = () => callService.mock.calls.map((call) => `${call[0]}.${call[1]}`);

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    header = document.createElement("button");
    header.setAttribute("data-action-scope", "header");
    header.dataset["entity"] = "sensor.primary";
    host.appendChild(header);
    config = {
      tap_action: serviceAction("test.tap"),
      hold_action: serviceAction("test.hold"),
      double_tap_action: serviceAction("test.double"),
    };
    const mocked = mockHass();
    callService = mocked.callService;
    controller = new HeaderActionController(
      host,
      () => mocked.hass,
      () => config,
      () => "Sure?"
    );
  });

  afterEach(() => {
    controller.disconnect();
    vi.useRealTimers();
  });

  it("ignores clicks outside the action scope", () => {
    expect(controller.handleClick(clickEvent(document.createElement("span")))).toBe(false);
    expect(callService).not.toHaveBeenCalled();
  });

  it("fires tap immediately when no double-tap action is configured", () => {
    config = { tap_action: serviceAction("test.tap") };
    expect(controller.handleClick(clickEvent())).toBe(true);
    expect(calledServices()).toEqual(["test.tap"]);
  });

  it("defaults tap to more-info on the header entity", () => {
    config = {};
    const seen: string[] = [];
    host.addEventListener("hass-more-info", (event) => {
      seen.push((event as Event & { detail: { entityId: string } }).detail.entityId);
    });
    controller.handleClick(clickEvent());
    expect(seen).toEqual(["sensor.primary"]);
  });

  it("delays tap while a double-tap could still happen", () => {
    controller.handleClick(clickEvent());
    expect(callService).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(calledServices()).toEqual(["test.tap"]);
  });

  it("fires double-tap for two quick clicks, swallowing the tap", () => {
    controller.handleClick(clickEvent());
    vi.advanceTimersByTime(100);
    controller.handleClick(clickEvent());
    expect(calledServices()).toEqual(["test.double"]);
    vi.advanceTimersByTime(1000);
    expect(calledServices()).toEqual(["test.double"]);
  });

  it("fires hold after 500ms and suppresses the following click", () => {
    controller.handlePointerDown(clickEvent());
    vi.advanceTimersByTime(500);
    expect(calledServices()).toEqual(["test.hold"]);
    controller.handleClick(clickEvent());
    vi.advanceTimersByTime(1000);
    expect(calledServices()).toEqual(["test.hold"]);
    // The suppression only applies to the click ending the hold gesture.
    controller.handleClick(clickEvent());
    controller.handleClick(clickEvent());
    expect(calledServices()).toEqual(["test.hold", "test.double"]);
  });

  it("does not fire hold when the pointer is released early", () => {
    controller.handlePointerDown(clickEvent());
    vi.advanceTimersByTime(300);
    controller.handlePointerEnd();
    vi.advanceTimersByTime(1000);
    expect(callService).not.toHaveBeenCalled();
  });

  it("skips the hold timer entirely without a hold action", () => {
    config = { tap_action: serviceAction("test.tap") };
    controller.handlePointerDown(clickEvent());
    vi.advanceTimersByTime(1000);
    expect(callService).not.toHaveBeenCalled();
  });

  it("cancels a pending delayed tap on disconnect", () => {
    controller.handleClick(clickEvent());
    controller.disconnect();
    vi.advanceTimersByTime(1000);
    expect(callService).not.toHaveBeenCalled();
  });
});
