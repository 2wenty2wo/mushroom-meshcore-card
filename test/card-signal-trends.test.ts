import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreCard } from "../src/card.js";
import type { HomeAssistant, MeshcoreCardConfig } from "../src/types.js";
import {
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  defineOnce,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const NODE_CONFIG: MeshcoreCardConfig = {
  target: { type: "node", id: NODE_NAME },
};
const SIGNAL_IDS = [
  `${NODE_PREFIX}last_rssi${NODE_SUFFIX}`,
  `${NODE_PREFIX}last_snr${NODE_SUFFIX}`,
  `${NODE_PREFIX}noise_floor${NODE_SUFFIX}`,
] as const;

function historyResponse(offset = 0): Record<string, unknown> {
  const nowSeconds = NOW / 1000;
  return {
    [SIGNAL_IDS[0]]: [
      { s: String(-80 + offset), lu: nowSeconds - 5 * 60 * 60 },
      { s: String(-55 + offset), lu: nowSeconds - 60 * 60 },
    ],
    [SIGNAL_IDS[1]]: [
      { s: String(2 + offset), lu: nowSeconds - 5 * 60 * 60 },
      { s: String(11 + offset), lu: nowSeconds - 60 * 60 },
    ],
    [SIGNAL_IDS[2]]: [
      { s: String(-120 + offset), lu: nowSeconds - 5 * 60 * 60 },
      { s: String(-111 + offset), lu: nowSeconds - 60 * 60 },
    ],
  };
}

function mount(
  hass: HomeAssistant,
  config: MeshcoreCardConfig = NODE_CONFIG
): MeshcoreCard {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settleThrottledGraphRender(): Promise<void> {
  await flushPromises();
  await vi.advanceTimersByTimeAsync(10_000);
  await flushPromises();
}

function graphPoints(card: MeshcoreCard): string[] {
  return Array.from(
    card.shadowRoot!.querySelectorAll(".metric-sparkline-line"),
    (line) => line.getAttribute("points") ?? ""
  );
}

describe("device signal history graphs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("loads all visible signals in one six-hour request and preserves metric controls", async () => {
    const hass = createHass();
    const callWS = vi.fn().mockResolvedValue(historyResponse());
    hass.callWS = callWS as HomeAssistant["callWS"];

    const card = mount(hass);
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(0);
    expect(callWS).toHaveBeenCalledWith({
      type: "history/history_during_period",
      start_time: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
      end_time: new Date(NOW).toISOString(),
      entity_ids: [...SIGNAL_IDS],
      include_start_time_state: true,
      significant_changes_only: true,
      minimal_response: true,
      no_attributes: true,
    });

    await settleThrottledGraphRender();

    const styles = card.shadowRoot!.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("--mushroom-meshcore-sparkline-opacity: 0.14");
    expect(styles).toContain("stroke-width: 1.25");
    const metrics = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLButtonElement>(".node-metric")
    );
    expect(metrics).toHaveLength(3);
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(3);
    for (const metric of metrics) {
      expect(metric.querySelector("ha-ripple")).not.toBeNull();
      expect(metric.querySelector(".metric-label")).not.toBeNull();
      expect(metric.querySelector(".metric-value")).not.toBeNull();
      expect(metric.getAttribute("aria-label")).toBeTruthy();
    }
    for (const points of graphPoints(card)) {
      expect(points).not.toMatch(/NaN|Infinity/);
    }

    const moreInfo = vi.fn();
    card.addEventListener("hass-more-info", moreInfo);
    metrics[0]!.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      entityId: SIGNAL_IDS[0],
    });
  });

  it("supports hiding and re-enabling only the graph layer", async () => {
    const hass = createHass();
    const callWS = vi.fn().mockResolvedValue(historyResponse());
    hass.callWS = callWS as HomeAssistant["callWS"];
    const card = mount(hass, { ...NODE_CONFIG, hide_signal_graphs: true });

    expect(callWS).not.toHaveBeenCalled();
    expect(card.shadowRoot!.querySelectorAll(".node-metric")).toHaveLength(3);
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(0);

    card.setConfig(NODE_CONFIG);
    expect(callWS).toHaveBeenCalledTimes(1);
    await settleThrottledGraphRender();
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(3);

    card.setConfig({ ...NODE_CONFIG, hide_signal_graphs: true });
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(0);
    expect(card.shadowRoot!.querySelectorAll(".node-metric")).toHaveLength(3);
    expect(callWS).toHaveBeenCalledTimes(1);
  });

  it("keeps the metric boxes usable when a history call throws synchronously", () => {
    const hass = createHass();
    const callWS = vi.fn(() => {
      throw new Error("Recorder unavailable");
    });
    hass.callWS = callWS as unknown as HomeAssistant["callWS"];

    let card: MeshcoreCard | undefined;
    expect(() => {
      card = mount(hass);
    }).not.toThrow();
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(card!.shadowRoot!.querySelectorAll(".node-metric")).toHaveLength(3);
    expect(card!.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(0);
  });

  it("ignores an old response after reconnecting and loading fresh history", async () => {
    const hass = createHass();
    let resolveOld!: (value: unknown) => void;
    const oldRequest = new Promise<unknown>((resolve) => {
      resolveOld = resolve;
    });
    const callWS = vi.fn()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce(historyResponse());
    hass.callWS = callWS as HomeAssistant["callWS"];

    const card = mount(hass);
    card.remove();
    document.body.appendChild(card);
    expect(callWS).toHaveBeenCalledTimes(2);
    await settleThrottledGraphRender();
    const freshPoints = graphPoints(card);
    expect(freshPoints).toHaveLength(3);

    resolveOld(historyResponse(1_000));
    await flushPromises();
    expect(graphPoints(card)).toEqual(freshPoints);
  });

  it("builds a real live-only graph after Recorder rejects", async () => {
    const hass = createHass();
    const callWS = vi.fn().mockRejectedValue(new Error("Recorder unavailable"));
    hass.callWS = callWS as HomeAssistant["callWS"];
    const card = mount(hass);

    await flushPromises();
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(0);

    const nextTime = NOW + 60_000;
    vi.setSystemTime(nextTime);
    hass.states[SIGNAL_IDS[0]] = state(-31, {}, new Date(nextTime).toISOString());
    card.hass = hass;

    expect(callWS).toHaveBeenCalledTimes(1);
    expect(card.shadowRoot!.querySelectorAll(".metric-sparkline")).toHaveLength(1);
    expect(
      card.shadowRoot!.querySelector(`[data-entity="${SIGNAL_IDS[0]}"] .metric-sparkline`)
    ).not.toBeNull();
  });

  it("refreshes history on connection ready and removes its listener on disconnect", async () => {
    const hass = createHass();
    const readyListeners = new Set<() => void>();
    const addEventListener = vi.fn((type: string, listener: () => void) => {
      if (type === "ready") readyListeners.add(listener);
    });
    const removeEventListener = vi.fn((type: string, listener: () => void) => {
      if (type === "ready") readyListeners.delete(listener);
    });
    hass.connection = {
      subscribeMessage: vi.fn(async () => () => undefined),
      addEventListener,
      removeEventListener,
    };
    const callWS = vi.fn().mockResolvedValue(historyResponse());
    hass.callWS = callWS as HomeAssistant["callWS"];

    const card = mount(hass);
    expect(addEventListener).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(callWS).toHaveBeenCalledTimes(1);
    await settleThrottledGraphRender();

    for (const listener of readyListeners) listener();
    expect(callWS).toHaveBeenCalledTimes(2);
    await settleThrottledGraphRender();

    card.remove();
    expect(removeEventListener).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(readyListeners).toHaveLength(0);
  });
});
