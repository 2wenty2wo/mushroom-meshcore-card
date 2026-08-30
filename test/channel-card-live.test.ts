// Live behavior of the channel card: the logbook stream subscription,
// message rendering, purge/limit maintenance, and reconnect handling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreChannelCard } from "../src/channel-card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreChannelCardConfig } from "../src/types.js";
import {
  CHANNEL_ENTITY,
  createChannelHass,
  defineOnce,
  shadowBody,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);

const t = makeLocalize("en");

interface LogbookEntry {
  when: number;
  name: string;
  message?: unknown;
  entity_id?: string;
  context_id?: string;
}

interface MockConnection {
  connection: NonNullable<HomeAssistant["connection"]>;
  subscribeMessage: ReturnType<typeof vi.fn>;
  callbacks: Array<(message: unknown) => void>;
  subscriptionParams: Record<string, unknown>[];
  readyListeners: Array<() => void>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createConnection(): MockConnection {
  const unsubscribe = vi.fn();
  const callbacks: Array<(message: unknown) => void> = [];
  const subscriptionParams: Record<string, unknown>[] = [];
  const readyListeners: Array<() => void> = [];
  const subscribeMessage = vi.fn(
    (callback: (message: unknown) => void, params: Record<string, unknown>) => {
      callbacks.push(callback);
      subscriptionParams.push(params);
      return Promise.resolve(unsubscribe);
    }
  );
  const connection = {
    subscribeMessage,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "ready") readyListeners.push(listener);
    },
    removeEventListener: vi.fn(),
  } as unknown as NonNullable<HomeAssistant["connection"]>;
  return {
    connection,
    subscribeMessage,
    callbacks,
    subscriptionParams,
    readyListeners,
    unsubscribe,
  };
}

function liveHass(mock: MockConnection, channelState?: string): HomeAssistant {
  const hass = createChannelHass(
    channelState === undefined ? {} : { channelState }
  );
  hass.connection = mock.connection;
  return hass;
}

async function createLiveCard(
  config: MeshcoreChannelCardConfig = { entity: CHANNEL_ENTITY },
  mock: MockConnection = createConnection(),
  hass: HomeAssistant = liveHass(mock)
): Promise<{ card: MeshcoreChannelCard; mock: MockConnection; hass: HomeAssistant }> {
  const card = document.createElement(
    "mushroom-meshcore-channel-card"
  ) as MeshcoreChannelCard;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  // Let all subscription promises resolve so their cleanup callbacks register.
  await vi.advanceTimersByTimeAsync(0);
  return { card, mock, hass };
}

function logbookCallback(mock: MockConnection): (message: unknown) => void {
  let callbackIndex = -1;
  for (let index = mock.subscriptionParams.length - 1; index >= 0; index -= 1) {
    if (mock.subscriptionParams[index]?.["type"] === "logbook/event_stream") {
      callbackIndex = index;
      break;
    }
  }
  expect(callbackIndex).toBeGreaterThanOrEqual(0);
  return mock.callbacks[callbackIndex]!;
}

function eventCallback(
  mock: MockConnection,
  eventType: "meshcore_message" | "meshcore_delivery_update" | "meshcore_message_sent"
): (message: unknown) => void {
  let callbackIndex = -1;
  for (let index = mock.subscriptionParams.length - 1; index >= 0; index -= 1) {
    const params = mock.subscriptionParams[index];
    if (
      params?.["type"] === "subscribe_events" &&
      params["event_type"] === eventType
    ) {
      callbackIndex = index;
      break;
    }
  }
  expect(callbackIndex).toBeGreaterThanOrEqual(0);
  return mock.callbacks[callbackIndex]!;
}

function feed(mock: MockConnection, events: LogbookEntry[]): void {
  logbookCallback(mock)({ events });
}

async function settleRender(): Promise<void> {
  // Stream renders are debounced 250ms; the scroll restore uses one rAF.
  await vi.advanceTimersByTimeAsync(300);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("channel card subscription", () => {
  it("subscribes to the logbook event stream for the configured entity", async () => {
    const { mock } = await createLiveCard();
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(4);
    const params = mock.subscriptionParams.find(
      (candidate) => candidate["type"] === "logbook/event_stream"
    )!;
    expect(params["type"]).toBe("logbook/event_stream");
    expect(params["entity_ids"]).toEqual([CHANNEL_ENTITY]);
    const start = new Date(String(params["start_time"])).getTime();
    expect(Date.now() - start).toBe(24 * 60 * 60 * 1000);
  });

  it("does not subscribe without a valid channel target", async () => {
    const { mock } = await createLiveCard({});
    expect(mock.subscribeMessage).not.toHaveBeenCalled();
  });

  it("keeps defensive subscription helpers inert without hass, connection, or target", () => {
    type SubscriptionInternals = {
      _selectedState: () => unknown;
      _subscribe: () => void;
      _subscribeRoutingEvent: (
        hass: HomeAssistant,
        subscriptionId: number,
        eventType: "meshcore_message"
      ) => void;
    };

    const withoutHass = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    withoutHass.setConfig({ entity: CHANNEL_ENTITY });
    const withoutHassInternals = withoutHass as unknown as SubscriptionInternals;
    expect(withoutHassInternals._selectedState()).toBeUndefined();
    expect(() => withoutHassInternals._subscribe()).not.toThrow();

    const noConnection = createChannelHass() as HomeAssistant & {
      connection?: HomeAssistant["connection"];
    };
    noConnection.connection = undefined;
    expect(() =>
      withoutHassInternals._subscribeRoutingEvent(
        noConnection,
        0,
        "meshcore_message"
      )
    ).not.toThrow();

    const mock = createConnection();
    const withoutTarget = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    withoutTarget.setConfig({});
    withoutTarget.hass = liveHass(mock);
    const withoutTargetInternals = withoutTarget as unknown as SubscriptionInternals;
    expect(withoutTargetInternals._selectedState()).toBeUndefined();
    expect(() =>
      withoutTargetInternals._subscribe()
    ).not.toThrow();
    expect(mock.subscribeMessage).not.toHaveBeenCalled();
  });

  it("stops the subscription when the entity becomes invalid", async () => {
    const { card, mock, hass } = await createLiveCard();
    delete hass.states[CHANNEL_ENTITY];
    card.hass = { ...hass };
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
    const calls = mock.subscribeMessage.mock.calls.length;
    mock.readyListeners[0]!();
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(calls);
  });

  it("unsubscribes when the card leaves the DOM", async () => {
    const { card, mock } = await createLiveCard();
    // A stream message just before removal leaves a debounced render pending;
    // disconnect must clear it alongside the subscription.
    feed(mock, [
      { when: nowSeconds() - 60, name: "ch", message: "Alice: parting words" },
    ]);
    card.remove();
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
    expect(() => card.disconnectedCallback()).not.toThrow();
    await settleRender();
    expect(shadowBody(card)).not.toContain("parting words");
  });

  it("survives a stale unsubscribe function that throws", async () => {
    const { card, mock } = await createLiveCard();
    mock.unsubscribe.mockImplementation(() => {
      throw new Error("socket already closed");
    });
    expect(() => card.remove()).not.toThrow();
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
  });

  it("absorbs rejected asynchronous unsubscribe cleanup", async () => {
    const { card, mock } = await createLiveCard();
    mock.unsubscribe.mockImplementation(() =>
      Promise.reject(new Error("dead socket promise"))
    );
    card.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
  });

  it("drops a subscription that resolves after the card disconnected", async () => {
    const mock = createConnection();
    // Even a broken unsubscribe from the dead socket must not surface.
    mock.unsubscribe.mockImplementation(() => {
      throw new Error("connection lost");
    });
    const card = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    card.setConfig({ entity: CHANNEL_ENTITY });
    card.hass = liveHass(mock);
    document.body.appendChild(card);
    card.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
  });

  it("restarts the stream when history-shaping config changes", async () => {
    const { card, mock } = await createLiveCard();
    card.setConfig({ entity: CHANNEL_ENTITY, hours_to_show: 48 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(8);
    const params = mock.subscriptionParams.filter(
      (candidate) => candidate["type"] === "logbook/event_stream"
    )[1]!;
    const start = new Date(String(params["start_time"])).getTime();
    expect(Date.now() - start).toBe(48 * 60 * 60 * 1000);
  });

  it("ignores stale Logbook and native-event callbacks after a restart", async () => {
    const { card, mock } = await createLiveCard();
    const staleLogbook = logbookCallback(mock);
    const staleMessageEvent = eventCallback(mock, "meshcore_message");
    const processRoutingEvent = vi.spyOn(
      card as unknown as { _processRoutingEvent: (...args: unknown[]) => void },
      "_processRoutingEvent"
    );

    card.setConfig({ entity: CHANNEL_ENTITY, hours_to_show: 48 });
    await vi.advanceTimersByTimeAsync(0);
    staleLogbook({
      events: [{
        when: nowSeconds(),
        name: "ch",
        entity_id: CHANNEL_ENTITY,
        message: "Stale Sender: ignored history",
      }],
    });
    staleMessageEvent({
      event_type: "meshcore_message",
      data: {
        message_type: "channel",
        entity_id: CHANNEL_ENTITY,
        sender_name: "Stale Sender",
        message: "ignored history",
        hop_count: 4,
      },
    });
    await settleRender();

    expect(processRoutingEvent).not.toHaveBeenCalled();
    expect(shadowBody(card)).not.toContain("ignored history");
  });

  it("ignores a stale history-failure notification", async () => {
    const { card } = await createLiveCard();
    const internals = card as unknown as {
      _failHistorySubscription: (subscriptionId: number) => void;
    };
    internals._failHistorySubscription(-1);
    expect(shadowBody(card)).not.toContain(
      t("card.channel_history_unavailable")
    );
  });

  it("keeps the stream across config changes that only affect rendering", async () => {
    const { card, mock } = await createLiveCard();
    card.setConfig({ entity: CHANNEL_ENTITY, hide_timestamps: true });
    expect(mock.unsubscribe).not.toHaveBeenCalled();
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(4);
  });

  it("resubscribes without unsubscribing when the socket reports ready", async () => {
    const { mock } = await createLiveCard();
    expect(mock.readyListeners.length).toBeGreaterThan(0);
    mock.readyListeners[0]!();
    // The old subscription died with the socket; it must not be torn down
    // on the new connection.
    expect(mock.unsubscribe).not.toHaveBeenCalled();
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(8);
  });

  it("moves the stream to a replaced connection object", async () => {
    const { card, mock, hass } = await createLiveCard();
    const next = createConnection();
    card.hass = { ...hass, connection: next.connection };
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribe).toHaveBeenCalledTimes(4);
    expect(next.subscribeMessage).toHaveBeenCalledTimes(4);
  });

  it("shows the unavailable state when subscribing throws", async () => {
    const mock = createConnection();
    mock.connection.subscribeMessage = (() => {
      throw new Error("socket closed");
    }) as never;
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      liveHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.channel_history_unavailable"));
  });

  it("shows the unavailable state when the subscription is rejected", async () => {
    const mock = createConnection();
    mock.connection.subscribeMessage = (() =>
      Promise.reject(new Error("nope"))) as never;
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      liveHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.channel_history_unavailable"));
  });

  it("retries a failed stream when the card re-enters the DOM", async () => {
    const mock = createConnection();
    let fail = true;
    const original = mock.connection.subscribeMessage.bind(mock.connection);
    mock.connection.subscribeMessage = ((callback: never, params: never, options: never) => {
      if (fail) throw new Error("socket closed");
      return original(callback, params, options);
    }) as never;
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      liveHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.channel_history_unavailable"));

    fail = false;
    card.remove();
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.callbacks).toHaveLength(4);
    feed(mock, [
      { when: nowSeconds() - 60, name: "ch", message: "Alice: recovered" },
    ]);
    await settleRender();
    expect(shadowBody(card)).toContain("recovered");
  });
});

describe("channel card message rendering", () => {
  it("omits an invalid direct render and tolerates history disappearing before scroll restore", async () => {
    const { card } = await createLiveCard();
    const internals = card as unknown as {
      _renderMessage: (entry: LogbookEntry) => string;
      _restoreScrollAnchor: (anchor: {
        top: number;
        height: number;
        atTop: boolean;
      }) => void;
    };
    expect(
      internals._renderMessage({ when: nowSeconds(), name: "missing message" })
    ).toBe("");

    let restoreFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        restoreFrame = callback;
        return 1;
      })
    );
    try {
      card.shadowRoot!.innerHTML = '<div class="channel-history"></div>';
      internals._restoreScrollAnchor({ top: 10, height: 20, atTop: false });
      card.shadowRoot!.innerHTML = "";
      expect(restoreFrame).toBeTypeOf("function");
      restoreFrame!(0);
      expect(card.shadowRoot!.innerHTML).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders parsed messages under grouped date headers", async () => {
    const { card, mock } = await createLiveCard({
      entity: CHANNEL_ENTITY,
      hours_to_show: 200,
    });
    const now = nowSeconds();
    feed(mock, [
      {
        when: now - 3600,
        name: "ch",
        message: "<Public> Alice: hello world",
        entity_id: CHANNEL_ENTITY,
        context_id: "c1",
      },
      {
        when: now - 86400,
        name: "ch",
        message: "Bob: yesterday news",
        entity_id: CHANNEL_ENTITY,
        context_id: "c2",
      },
      {
        when: now - 3 * 86400,
        name: "ch",
        message: "<Public> plain announcement",
        entity_id: CHANNEL_ENTITY,
        context_id: "c3",
      },
    ]);
    await settleRender();
    const body = shadowBody(card);
    expect(body).toContain('class="message-sender">Alice</strong>');
    expect(body).toContain("hello world");
    expect(body).toContain("yesterday news");
    // Sender-less messages render without the emphasized sender element.
    expect(body).toContain("plain announcement");
    expect(body).toContain(t("card.today"));
    expect(body).toContain(t("card.yesterday"));
    const headers = body.match(/class="date-header"/g) ?? [];
    expect(headers).toHaveLength(3);
    expect(body).toContain('class="message-time"');
  });

  it("dedupes replayed history entries", async () => {
    const { card, mock } = await createLiveCard();
    const entry = {
      when: nowSeconds() - 60,
      name: "ch",
      message: "Alice: once only",
      entity_id: CHANNEL_ENTITY,
      context_id: "c1",
    };
    feed(mock, [entry]);
    feed(mock, [entry]);
    await settleRender();
    const body = shadowBody(card);
    expect(body.match(/once only/g)).toHaveLength(1);
  });

  it("ignores malformed or foreign stream entries", async () => {
    const { card, mock } = await createLiveCard();
    const now = nowSeconds();
    logbookCallback(mock)({ events: "not-an-array" });
    feed(mock, [
      { when: 0, name: "bad", message: "Alice: zero timestamp" },
      {
        when: now - 30,
        name: "foreign",
        message: "Eve: other channel",
        entity_id: "binary_sensor.meshcore_other_ch_1_messages",
      },
      { when: now - 20, name: "no-message" },
      { when: now - 15, name: "non-string", message: 42 },
      { when: now - 10, name: "blank", message: "  <Public>  " },
      {
        when: now - 5,
        name: "ok",
        message: "Alice: kept",
        entity_id: CHANNEL_ENTITY,
      },
    ]);
    await settleRender();
    const body = shadowBody(card);
    expect(body).toContain("kept");
    expect(body).not.toContain("zero timestamp");
    expect(body).not.toContain("other channel");
  });

  it("shows the empty state once history arrives with no messages", async () => {
    const { card, mock } = await createLiveCard();
    expect(shadowBody(card)).toContain(t("card.channel_history_loading"));
    feed(mock, []);
    await settleRender();
    expect(shadowBody(card)).toContain(
      t("card.channel_history_empty", { hours: 24 })
    );
  });

  it("honors hide_timestamps and hide_date_headers", async () => {
    const { card, mock } = await createLiveCard({
      entity: CHANNEL_ENTITY,
      hide_timestamps: true,
      hide_date_headers: true,
    });
    feed(mock, [
      {
        when: nowSeconds() - 60,
        name: "ch",
        message: "Alice: quiet meta",
        entity_id: CHANNEL_ENTITY,
      },
      {
        // No sender and no time leaves the row without a meta line at all.
        when: nowSeconds() - 50,
        name: "ch",
        message: "<Public> bare announcement",
        entity_id: CHANNEL_ENTITY,
      },
    ]);
    await settleRender();
    const body = shadowBody(card);
    expect(body).toContain("quiet meta");
    expect(body).toContain("bare announcement");
    expect(body).not.toContain('class="date-header"');
    expect(body).not.toContain('class="message-time"');
    expect(body.match(/class="message-meta"/g)).toHaveLength(1);
  });

  it("renders a meta-only row for a sender with an empty body", async () => {
    const { card, mock } = await createLiveCard();
    feed(mock, [
      { when: nowSeconds() - 60, name: "ch", message: "Quietest:" },
    ]);
    await settleRender();
    const body = shadowBody(card);
    expect(body).toContain('class="message-sender">Quietest</strong>');
    expect(body).not.toContain('class="message-body"');
  });

  it("keeps a scrolled-back reading position across renders", async () => {
    const { card, mock } = await createLiveCard();
    feed(mock, [
      { when: nowSeconds() - 120, name: "ch", message: "Alice: first" },
    ]);
    await settleRender();
    const history = card.shadowRoot!.querySelector<HTMLElement>(
      ".channel-history"
    )!;
    history.scrollTop = 50;
    feed(mock, [
      { when: nowSeconds() - 30, name: "ch", message: "Alice: second" },
    ]);
    await settleRender();
    const restored = card.shadowRoot!.querySelector<HTMLElement>(
      ".channel-history"
    )!;
    // Layout heights stay 0 under happy-dom, so the offset math preserves
    // the captured position verbatim.
    expect(restored.scrollTop).toBe(50);
  });

  it("caps the list at max_messages, keeping the newest", async () => {
    const { card, mock } = await createLiveCard({
      entity: CHANNEL_ENTITY,
      max_messages: 2,
    });
    const now = nowSeconds();
    feed(mock, [
      { when: now - 300, name: "ch", message: "Alice: oldest" },
      { when: now - 200, name: "ch", message: "Alice: middle" },
      { when: now - 100, name: "ch", message: "Alice: newest" },
    ]);
    await settleRender();
    const body = shadowBody(card);
    expect(body).toContain("newest");
    expect(body).toContain("middle");
    expect(body).not.toContain("oldest");
  });

  it("purges aged-out messages on the maintenance tick", async () => {
    const { card, mock } = await createLiveCard({
      entity: CHANNEL_ENTITY,
      hours_to_show: 1,
    });
    feed(mock, [
      { when: nowSeconds() - 3595, name: "ch", message: "Alice: fading" },
    ]);
    await settleRender();
    expect(shadowBody(card)).toContain("fading");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(shadowBody(card)).toContain(
      t("card.channel_history_empty", { hours: 1 })
    );
  });

  it("formats times per the hass locale settings", async () => {
    const mock = createConnection();
    const hass = liveHass(mock);
    hass.locale = {
      language: "en",
      time_format: "12",
      time_zone: "server",
    };
    hass.config = { time_zone: "UTC" };
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      hass
    );
    feed(mock, [
      { when: nowSeconds() - 60, name: "ch", message: "Alice: clocked" },
    ]);
    await settleRender();
    expect(shadowBody(card)).toMatch(/class="message-time"[^<]*>11:59:00\sAM/);
  });

  it("falls back to default formatting for a broken locale", async () => {
    const mock = createConnection();
    const hass = liveHass(mock);
    hass.language = "not a locale!";
    hass.locale = { language: "not a locale!", time_format: "24" };
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      hass
    );
    feed(mock, [
      { when: nowSeconds() - 60, name: "ch", message: "Alice: resilient" },
    ]);
    await settleRender();
    expect(shadowBody(card)).toContain("resilient");
  });
});

describe("channel card chrome", () => {
  it("uses the locale language and then English when top-level language is absent", async () => {
    const germanMock = createConnection();
    const germanHass = liveHass(germanMock, "off");
    (germanHass as unknown as { language?: string }).language = undefined;
    germanHass.locale = { language: "de" };
    const { card: germanCard } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      germanMock,
      germanHass
    );
    expect(shadowBody(germanCard)).toContain(makeLocalize("de")("card.inactive"));

    const defaultMock = createConnection();
    const defaultHass = liveHass(defaultMock, "off");
    (defaultHass as unknown as { language?: string }).language = undefined;
    defaultHass.locale = {} as HomeAssistant["locale"];
    const { card: defaultCard } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      defaultMock,
      defaultHass
    );
    expect(shadowBody(defaultCard)).toContain(t("card.inactive"));
  });

  it("marks an inactive channel with the inactive state", async () => {
    const mock = createConnection();
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      liveHass(mock, "off")
    );
    expect(shadowBody(card)).toContain(t("card.inactive"));
  });

  it("keeps the raw channel name when the entity has no registry entry", async () => {
    const mock = createConnection();
    const hass = liveHass(mock);
    delete hass.entities[CHANNEL_ENTITY];
    const { card } = await createLiveCard(
      { entity: CHANNEL_ENTITY },
      mock,
      hass
    );
    expect(shadowBody(card)).toContain('<span slot="primary">');
  });

  it("switches to the grid-rows layout when rows are constrained", async () => {
    const { card } = await createLiveCard({
      entity: CHANNEL_ENTITY,
      grid_options: { rows: 4 },
    });
    expect(card.shadowRoot!.innerHTML).toContain(
      'class="channel-chat-card grid-rows"'
    );
  });

  it("dispatches more-info from a header tap", async () => {
    const { card } = await createLiveCard();
    const seen: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      seen.push(
        (event as Event & { detail: { entityId: string } }).detail.entityId
      );
    });
    const header = card.shadowRoot!.querySelector("[data-action-scope]")!;
    header.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(seen).toEqual([CHANNEL_ENTITY]);
  });

  it("runs a configured hold action from the header", async () => {
    const mock = createConnection();
    const hass = liveHass(mock);
    const callService = vi.fn();
    hass.callService = callService;
    const { card } = await createLiveCard(
      {
        entity: CHANNEL_ENTITY,
        hold_action: { action: "perform-action", perform_action: "test.hold" },
      },
      mock,
      hass
    );
    const header = card.shadowRoot!.querySelector("[data-action-scope]")!;
    header.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true })
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(callService).toHaveBeenCalledWith(
      "test",
      "hold",
      undefined,
      undefined
    );
    header.dispatchEvent(
      new Event("pointerup", { bubbles: true, composed: true })
    );
  });

  it("reports its lovelace sizing hints", async () => {
    const { card } = await createLiveCard();
    expect(card.getCardSize()).toBe(8);
    expect(card.getGridOptions()).toEqual({
      columns: "full",
      rows: 8,
      min_columns: 6,
      min_rows: 4,
    });
    expect(MeshcoreChannelCard.getConfigElement().tagName.toLowerCase()).toBe(
      "mushroom-meshcore-channel-card-editor"
    );
  });
});
