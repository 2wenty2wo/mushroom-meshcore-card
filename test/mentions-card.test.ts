import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreMentionsCard } from "../src/mentions-card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreMentionsCardConfig } from "../src/types.js";
import { createHass, defineOnce, shadowBody, state } from "./fixtures.js";

defineOnce("mushroom-meshcore-mentions-card", MeshcoreMentionsCard);

const TODO_ENTITY = "todo.meshcore_tags";
const SECOND_TODO_ENTITY = "todo.meshcore_mentions_archive";
const t = makeLocalize("en");

interface TodoItem {
  uid: string;
  summary: string;
  status: "needs_action" | "completed" | null;
  description?: string | null;
}

interface MockConnection {
  connection: NonNullable<HomeAssistant["connection"]>;
  subscribeMessage: ReturnType<typeof vi.fn>;
  callbacks: Array<(message: { items: unknown[] }) => void>;
  readyListeners: Array<() => void>;
  removeEventListener: ReturnType<typeof vi.fn>;
  unsubscribes: Array<ReturnType<typeof vi.fn>>;
}

function createConnection(): MockConnection {
  const callbacks: Array<(message: { items: unknown[] }) => void> = [];
  const readyListeners: Array<() => void> = [];
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  const subscribeMessage = vi.fn(
    (
      callback: (message: { items: unknown[] }) => void,
      _params: Record<string, unknown>,
      _options?: { resubscribe?: boolean }
    ) => {
      callbacks.push(callback);
      const unsubscribe = vi.fn();
      unsubscribes.push(unsubscribe);
      return Promise.resolve(unsubscribe);
    }
  );
  const removeEventListener = vi.fn(
    (type: string, listener: () => void) => {
      if (type !== "ready") return;
      const index = readyListeners.indexOf(listener);
      if (index >= 0) readyListeners.splice(index, 1);
    }
  );
  const connection = {
    subscribeMessage,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "ready") readyListeners.push(listener);
    },
    removeEventListener,
  } as unknown as NonNullable<HomeAssistant["connection"]>;
  return {
    connection,
    subscribeMessage,
    callbacks,
    readyListeners,
    removeEventListener,
    unsubscribes,
  };
}

function createMentionsHass(
  mock: MockConnection = createConnection(),
  options: {
    entityState?: string;
    supportedFeatures?: unknown;
    callService?: HomeAssistant["callService"];
    includeSecond?: boolean;
  } = {}
): HomeAssistant {
  const hass = createHass();
  const todo = state(options.entityState ?? "0", {
    friendly_name: "MeshCore Tags",
    supported_features: (options.supportedFeatures ?? 4) as number,
  });
  todo.entity_id = TODO_ENTITY;
  hass.states[TODO_ENTITY] = todo;
  if (options.includeSecond) {
    const second = state("0", {
      friendly_name: "Archived MeshCore Mentions",
      supported_features: 4,
    });
    second.entity_id = SECOND_TODO_ENTITY;
    hass.states[SECOND_TODO_ENTITY] = second;
  }
  hass.connection = mock.connection;
  hass.callService = options.callService ?? vi.fn().mockResolvedValue(undefined);
  return hass;
}

async function createCard(
  config: MeshcoreMentionsCardConfig = { entity: TODO_ENTITY },
  mock: MockConnection = createConnection(),
  hass: HomeAssistant = createMentionsHass(mock)
): Promise<{
  card: MeshcoreMentionsCard;
  mock: MockConnection;
  hass: HomeAssistant;
}> {
  const card = document.createElement(
    "mushroom-meshcore-mentions-card"
  ) as MeshcoreMentionsCard;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  await vi.advanceTimersByTimeAsync(0);
  return { card, mock, hass };
}

function feed(
  mock: MockConnection,
  items: unknown[],
  callbackIndex = 0
): void {
  mock.callbacks[callbackIndex]!({ items });
}

function clickMention(card: MeshcoreMentionsCard, uid: string): void {
  card.shadowRoot!
    .querySelector<HTMLElement>(`[data-mention-uid="${uid}"]`)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

const pendingItem = (
  uid = "mention-a",
  summary = "Alice on Public: Hello MeshCore"
): TodoItem => ({ uid, summary, status: "needs_action" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("mentions card target states", () => {
  it("does not render until both config and hass are supplied", () => {
    const card = new MeshcoreMentionsCard();
    card.setConfig({});
    expect(card.shadowRoot!.innerHTML).toBe("");

    const other = new MeshcoreMentionsCard();
    other.hass = createMentionsHass();
    expect(other.shadowRoot!.innerHTML).toBe("");
  });

  it("renders distinct missing, invalid, and unresolved target prompts", async () => {
    const noTarget = await createCard({});
    expect(shadowBody(noTarget.card)).toContain(t("card.select_mentions_prompt"));
    expect(noTarget.mock.subscribeMessage).not.toHaveBeenCalled();

    const invalid = await createCard({ entity: "sensor.meshcore_tags" });
    expect(shadowBody(invalid.card)).toContain(
      t("card.mentions_invalid_entity", { id: "sensor.meshcore_tags" })
    );
    expect(invalid.mock.subscribeMessage).not.toHaveBeenCalled();

    const unresolved = await createCard({ entity: "todo.missing_mentions" });
    expect(shadowBody(unresolved.card)).toContain(
      t("card.mentions_not_found", { id: "todo.missing_mentions" })
    );
    expect(unresolved.mock.subscribeMessage).not.toHaveBeenCalled();
  });

  it.each(["unknown", "unavailable"])(
    "renders the entity-unavailable state for %s",
    async (entityState) => {
      const mock = createConnection();
      const { card } = await createCard(
        { entity: TODO_ENTITY },
        mock,
        createMentionsHass(mock, { entityState })
      );
      const body = shadowBody(card);
      expect(body).toContain(t("card.mentions_entity_unavailable"));
      expect(body).toContain(t("card.unavailable"));
      expect(mock.subscribeMessage).not.toHaveBeenCalled();
    }
  );

  it("waits for a connection when the entity itself is available", async () => {
    const hass = createMentionsHass();
    delete hass.connection;
    const card = new MeshcoreMentionsCard();
    card.setConfig({ entity: TODO_ENTITY });
    card.hass = hass;
    document.body.appendChild(card);
    expect(shadowBody(card)).toContain(t("card.mentions_loading"));
  });
});

describe("mentions card subscription lifecycle", () => {
  it("subscribes to todo items with Home Assistant resubscribe disabled", async () => {
    const { card, mock } = await createCard();
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(mock.subscribeMessage.mock.calls[0]![1]).toEqual({
      type: "todo/item/subscribe",
      entity_id: TODO_ENTITY,
    });
    expect(mock.subscribeMessage.mock.calls[0]![2]).toEqual({
      resubscribe: false,
    });
    expect(shadowBody(card)).toContain(t("card.mentions_loading"));
    expect(shadowBody(card)).toContain(t("card.mentions_loading_short"));
  });

  it("unsubscribes and removes the ready listener when disconnected", async () => {
    const { card, mock } = await createCard();
    card.remove();
    expect(mock.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(mock.removeEventListener).toHaveBeenCalledWith(
      "ready",
      expect.any(Function)
    );
  });

  it("ignores an unsubscribe function that throws", async () => {
    const { card, mock } = await createCard();
    mock.unsubscribes[0]!.mockImplementation(() => {
      throw new Error("dead socket");
    });
    expect(() => card.remove()).not.toThrow();
  });

  it("cleans up a subscription that resolves after disconnect", async () => {
    const mock = createConnection();
    let resolveSubscription!: (unsubscribe: () => void) => void;
    const subscribe = vi.fn(
      (callback: (message: { items: unknown[] }) => void) => {
        mock.callbacks.push(callback);
        return new Promise<() => void>((resolve) => {
          resolveSubscription = resolve;
        });
      }
    );
    mock.connection.subscribeMessage = subscribe as never;
    mock.subscribeMessage = subscribe;
    const card = new MeshcoreMentionsCard();
    card.setConfig({ entity: TODO_ENTITY });
    card.hass = createMentionsHass(mock);
    document.body.appendChild(card);
    card.remove();
    const lateUnsubscribe = vi.fn(() => {
      throw new Error("already closed");
    });
    resolveSubscription(lateUnsubscribe);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("shows unavailable when subscribing throws synchronously", async () => {
    const mock = createConnection();
    const subscribe = vi.fn(() => {
      throw new Error("socket closed");
    });
    mock.connection.subscribeMessage = subscribe as never;
    mock.subscribeMessage = subscribe;
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.mentions_unavailable"));
    expect(shadowBody(card)).toContain(t("card.unavailable"));
  });

  it("shows unavailable when the subscription promise rejects", async () => {
    const mock = createConnection();
    const subscribe = vi.fn(() => Promise.reject(new Error("denied")));
    mock.connection.subscribeMessage = subscribe as never;
    mock.subscribeMessage = subscribe;
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.mentions_unavailable"));
  });

  it("retries a failed subscription when reconnected to the DOM", async () => {
    const mock = createConnection();
    const workingSubscribe = mock.connection.subscribeMessage.bind(
      mock.connection
    );
    let fail = true;
    const subscribe = vi.fn(
      (
        callback: (message: { items: unknown[] }) => void,
        params: Record<string, unknown>,
        options: { resubscribe?: boolean }
      ) => {
        if (fail) throw new Error("offline");
        return workingSubscribe(callback, params, options);
      }
    );
    mock.connection.subscribeMessage = subscribe as never;
    mock.subscribeMessage = subscribe;
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock)
    );
    expect(shadowBody(card)).toContain(t("card.mentions_unavailable"));

    fail = false;
    card.remove();
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribe).toHaveBeenCalledTimes(2);
    feed(mock, [pendingItem()]);
    expect(shadowBody(card)).toContain("Hello MeshCore");
  });

  it("resubscribes on socket ready without calling the dead handle", async () => {
    const { card, mock } = await createCard();
    expect(mock.readyListeners).toHaveLength(1);
    mock.readyListeners[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.subscribeMessage).toHaveBeenCalledTimes(2);
    expect(mock.unsubscribes[0]).not.toHaveBeenCalled();

    feed(mock, [pendingItem("old", "Old on Public: stale")], 0);
    expect(shadowBody(card)).not.toContain("stale");
    feed(mock, [pendingItem("new", "New on Public: current")], 1);
    expect(shadowBody(card)).toContain("current");
  });

  it("moves the subscription when the connection object changes", async () => {
    const { card, mock, hass } = await createCard();
    const next = createConnection();
    card.hass = {
      ...hass,
      connection: next.connection,
    };
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(next.subscribeMessage).toHaveBeenCalledTimes(1);
  });

  it("stops subscribing when the selected entity becomes unavailable", async () => {
    const { card, mock, hass } = await createCard();
    hass.states[TODO_ENTITY]!.state = "unavailable";
    card.hass = { ...hass };
    expect(mock.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(shadowBody(card)).toContain(t("card.mentions_entity_unavailable"));
  });

  it("switches entity, resets data, and ignores the stale callback", async () => {
    const mock = createConnection();
    const hass = createMentionsHass(mock, { includeSecond: true });
    const { card } = await createCard({ entity: TODO_ENTITY }, mock, hass);
    feed(mock, [pendingItem("first", "Alice on Public: first")]);
    expect(shadowBody(card)).toContain("first");

    card.setConfig({ entity: SECOND_TODO_ENTITY });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(mock.subscribeMessage.mock.calls[1]![1]).toEqual({
      type: "todo/item/subscribe",
      entity_id: SECOND_TODO_ENTITY,
    });
    expect(shadowBody(card)).toContain(t("card.mentions_loading"));
    feed(mock, [pendingItem("stale", "Old on Public: ignored")], 0);
    expect(shadowBody(card)).not.toContain("ignored");
    feed(mock, [pendingItem("second", "Bob on Team: second")], 1);
    expect(shadowBody(card)).toContain("second");
  });
});

describe("mentions card rendering", () => {
  it("parses sender, last channel delimiter, message, and description safely", async () => {
    const { card, mock } = await createCard();
    feed(mock, [
      {
        uid: "mention-<a>",
        summary: "Rock on Radio & <Admin> on Ops: First: keep\nsecond <line>",
        status: "needs_action",
        description: "Details <unsafe> & more",
      },
      { uid: "complete", summary: "Bob on Team: hidden", status: "completed" },
    ]);
    const body = shadowBody(card);
    expect(body).toContain("Rock on Radio &amp; &lt;Admin&gt;");
    expect(body).toContain(t("card.mentions_channel", { channel: "Ops" }));
    expect(body).toContain("First: keep\nsecond &lt;line&gt;");
    expect(body).toContain("Details &lt;unsafe&gt; &amp; more");
    expect(
      card.shadowRoot!
        .querySelector("[data-mention-uid]")!
        .getAttribute("data-mention-uid")
    ).toBe("mention-<a>");
    expect(body).not.toContain("Bob on Team");
    expect(card.shadowRoot!.querySelector("admin")).toBeNull();
    expect(body).toContain(t("card.mentions_count_one"));
  });

  it("falls back to the exact escaped summary for malformed formats", async () => {
    const { card, mock } = await createCard();
    feed(mock, [
      pendingItem("a", "<script>alert('x')</script>"),
      pendingItem("b", ": no prefix"),
      pendingItem("c", "Alice: no channel"),
      pendingItem("d", " on Ops: no sender"),
      pendingItem("e", "Alice on : no channel name"),
    ]);
    const body = shadowBody(card);
    expect(
      card.shadowRoot!.querySelector(".mention-fallback")!.textContent
    ).toBe("<script>alert('x')</script>");
    expect(card.shadowRoot!.querySelector("script")).toBeNull();
    for (const summary of [
      ": no prefix",
      "Alice: no channel",
      " on Ops: no sender",
      "Alice on : no channel name",
    ]) {
      expect(body).toContain(summary);
    }
    expect(body.match(/class="mention-fallback"/g)).toHaveLength(5);
  });

  it("filters malformed todo items and treats null status as pending", async () => {
    const { card, mock } = await createCard();
    mock.callbacks[0]!({ items: "not an array" as never });
    expect(shadowBody(card)).toContain(t("card.mentions_loading"));
    feed(mock, [
      null,
      "text",
      { uid: 4, summary: "bad uid", status: "needs_action" },
      { uid: "bad-summary", summary: 5, status: "needs_action" },
      { uid: "bad-status", summary: "bad", status: "cancelled" },
      {
        uid: "bad-description",
        summary: "bad",
        status: null,
        description: 42,
      },
      {
        uid: "valid",
        summary: "Fallback pending",
        status: null,
        description: null,
      },
    ]);
    const body = shadowBody(card);
    expect(body.match(/class="mention-row/g)).toHaveLength(1);
    expect(body).toContain("Fallback pending");
    expect(body).toContain(t("card.mentions_count_one"));
  });

  it("renders empty when no pending mentions remain and completed are hidden", async () => {
    const { card, mock } = await createCard();
    feed(mock, [
      { uid: "done", summary: "Done on Ops: handled", status: "completed" },
    ]);
    const body = shadowBody(card);
    expect(body).toContain(t("card.mentions_empty"));
    expect(body).toContain(t("card.mentions_count", { n: 0 }));
    expect(card.shadowRoot!.querySelector(".mention-row")).toBeNull();
    expect(body).not.toContain("only handled");
  });

  it("shows pending and handled sections in server order when requested", async () => {
    const { card, mock } = await createCard({
      entity: TODO_ENTITY,
      hide_completed: false,
    });
    feed(mock, [
      pendingItem("p1", "First on Public: one"),
      { uid: "c1", summary: "Done on Ops: two", status: "completed" },
      pendingItem("p2", "Third on Team: three"),
    ]);
    const body = shadowBody(card);
    expect(body).toContain(t("card.mentions_pending"));
    expect(body).toContain(t("card.mentions_handled"));
    expect(body.indexOf("one")).toBeLessThan(body.indexOf("three"));
    expect(body).toContain("two");
    expect(body).toContain('aria-checked="true"');
    expect(body).toContain("mdi:check");
  });

  it("omits empty sections while completed items remain visible", async () => {
    const completed = {
      uid: "done",
      summary: "Done on Ops: only handled",
      status: "completed" as const,
    };
    const completedCard = await createCard({
      entity: TODO_ENTITY,
      hide_completed: false,
    });
    feed(completedCard.mock, [completed]);
    expect(shadowBody(completedCard.card)).not.toContain(
      `>${t("card.mentions_pending")}<`
    );
    expect(shadowBody(completedCard.card)).toContain(
      `>${t("card.mentions_handled")}<`
    );

    const pendingCard = await createCard({
      entity: TODO_ENTITY,
      hide_completed: false,
    });
    feed(pendingCard.mock, [pendingItem()]);
    expect(shadowBody(pendingCard.card)).toContain(
      `>${t("card.mentions_pending")}<`
    );
    expect(shadowBody(pendingCard.card)).not.toContain(
      `>${t("card.mentions_handled")}<`
    );
  });

  it("uses custom Tile appearance and a constrained grid layout", async () => {
    const { card, mock } = await createCard({
      entity: TODO_ENTITY,
      name: "Radio Mentions",
      icon: "mdi:message-alert",
      icon_color: "orange",
      grid_options: { columns: "full", rows: 6 },
    });
    feed(mock, [pendingItem()]);
    const body = shadowBody(card);
    expect(body).toContain("Radio Mentions");
    expect(body).toContain("mdi:message-alert");
    expect(body).toContain("--orange-color");
    expect(body).toContain('class="mentions-card grid-rows"');
  });

  it("reports Lovelace sizing, editor, and empty stub metadata", () => {
    const card = new MeshcoreMentionsCard();
    expect(card.getCardSize()).toBe(4);
    expect(card.getGridOptions()).toEqual({
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 1,
    });
    expect(MeshcoreMentionsCard.getStubConfig()).toEqual({});
    expect(
      MeshcoreMentionsCard.getConfigElement().tagName.toLowerCase()
    ).toBe("mushroom-meshcore-mentions-card-editor");
  });
});

describe("mentions card item actions", () => {
  it("marks a pending item completed with the exact todo service call", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const mock = createConnection();
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock, { callService })
    );
    feed(mock, [pendingItem()]);
    clickMention(card, "mention-a");
    const pendingButton = card.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-mention-uid]"
    )!;
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(0);
    expect(callService).toHaveBeenCalledWith(
      "todo",
      "update_item",
      { item: "mention-a", status: "completed" },
      { entity_id: TODO_ENTITY }
    );
    expect(shadowBody(card)).toContain(t("card.mentions_empty"));
  });

  it("reopens a handled item", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const mock = createConnection();
    const { card } = await createCard(
      { entity: TODO_ENTITY, hide_completed: false },
      mock,
      createMentionsHass(mock, { callService })
    );
    feed(mock, [
      {
        uid: "handled",
        summary: "Bob on Team: done",
        status: "completed",
      },
    ]);
    const label = card.shadowRoot!
      .querySelector<HTMLElement>("[data-mention-uid=handled]")!
      .getAttribute("aria-label");
    expect(label).toBe(
      t("card.mentions_reopen_label", { item: "Bob on Team: done" })
    );
    clickMention(card, "handled");
    await vi.advanceTimersByTimeAsync(0);
    expect(callService).toHaveBeenCalledWith(
      "todo",
      "update_item",
      { item: "handled", status: "needs_action" },
      { entity_id: TODO_ENTITY }
    );
    expect(shadowBody(card)).toContain(t("card.mentions_count_one"));
  });

  it("suppresses repeat input while an update is pending", async () => {
    let resolveService!: () => void;
    const callService = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveService = resolve;
        })
    );
    const mock = createConnection();
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock, { callService })
    );
    feed(mock, [pendingItem()]);
    clickMention(card, "mention-a");
    clickMention(card, "mention-a");
    expect(callService).toHaveBeenCalledTimes(1);
    resolveService();
    await vi.advanceTimersByTimeAsync(0);
    expect(shadowBody(card)).not.toContain('aria-busy="true"');
  });

  it("keeps the item pending and shows a localized error on rejection", async () => {
    const callService = vi.fn().mockRejectedValue(new Error("denied"));
    const mock = createConnection();
    const { card } = await createCard(
      { entity: TODO_ENTITY },
      mock,
      createMentionsHass(mock, { callService })
    );
    feed(mock, [pendingItem()]);
    clickMention(card, "mention-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(shadowBody(card)).toContain(t("card.mentions_update_failed"));
    expect(shadowBody(card)).toContain('aria-checked="false"');

    feed(mock, [pendingItem("fresh", "Alice on Public: refreshed")]);
    expect(shadowBody(card)).not.toContain(t("card.mentions_update_failed"));
  });

  it.each([0, "not-a-number"])(
    "disables updates when supported_features is %s",
    async (supportedFeatures) => {
      const callService = vi.fn();
      const mock = createConnection();
      const { card } = await createCard(
        { entity: TODO_ENTITY },
        mock,
        createMentionsHass(mock, { supportedFeatures, callService })
      );
      feed(mock, [pendingItem()]);
      const button = card.shadowRoot!.querySelector<HTMLButtonElement>(
        "[data-mention-uid]"
      )!;
      expect(button.disabled).toBe(true);
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
      expect(callService).not.toHaveBeenCalled();
    }
  );

  it("ignores unknown UIDs and a missing callService function", async () => {
    const callService = vi.fn();
    const mock = createConnection();
    const hass = createMentionsHass(mock, { callService });
    const { card } = await createCard({ entity: TODO_ENTITY }, mock, hass);
    feed(mock, [pendingItem()]);
    const rogue = document.createElement("button");
    rogue.dataset["mentionUid"] = "missing";
    card.shadowRoot!.appendChild(rogue);
    rogue.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(callService).not.toHaveBeenCalled();

    delete hass.callService;
    clickMention(card, "mention-a");
    expect(callService).not.toHaveBeenCalled();
  });

  it("opens more-info from the header and supports configured hold actions", async () => {
    const callService = vi.fn();
    const mock = createConnection();
    const { card } = await createCard(
      {
        entity: TODO_ENTITY,
        hold_action: {
          action: "perform-action",
          perform_action: "test.hold",
        },
      },
      mock,
      createMentionsHass(mock, { callService })
    );
    const moreInfo: string[] = [];
    card.addEventListener("hass-more-info", (event) => {
      moreInfo.push(
        (event as CustomEvent<{ entityId: string }>).detail.entityId
      );
    });
    const header = card.shadowRoot!.querySelector<HTMLElement>(
      "[data-action-scope]"
    )!;
    header.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(moreInfo).toEqual([TODO_ENTITY]);

    header.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true })
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(callService).toHaveBeenCalledWith("test", "hold", undefined, undefined);
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      header.dispatchEvent(
        new PointerEvent(type, { bubbles: true, composed: true })
      );
    }
  });
});
