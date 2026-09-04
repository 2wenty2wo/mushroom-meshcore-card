// Adversarial rendering tests for hostile mesh data. Every string these cards
// display can be chosen by whoever operates a radio in range: MeshCore adverts
// carry an unvalidated `adv_name`, and channel/DM traffic is attacker-authored
// end to end. The integration stores those strings verbatim, and these cards
// build their markup as strings assigned to `innerHTML`, so escaping is the
// only thing standing between a crafted advert and script execution inside the
// Home Assistant frontend origin. These tests pin that guarantee at the DOM
// level rather than by string matching, so a regression fails loudly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HassEntity } from "home-assistant-js-websocket";
import { MeshcoreCard } from "../src/card.js";
import { MeshcoreChannelCard } from "../src/channel-card.js";
import { MeshcoreMentionsCard } from "../src/mentions-card.js";
import type {
  HomeAssistant,
  MeshcoreCardConfig,
  MeshcoreChannelCardConfig,
  MeshcoreMentionsCardConfig,
} from "../src/types.js";
import {
  CHANNEL_ENTITY,
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  HUB_STATUS_ENTITY,
  NODE_CONTACT_ENTITY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  createChannelHass,
  createHass,
  createRoutingContactHass,
  defineOnce,
  registryEntry,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);
defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);
defineOnce("mushroom-meshcore-mentions-card", MeshcoreMentionsCard);

const TODO_ENTITY = "todo.meshcore_tags";

/** Payloads a hostile node operator can put in an advert name or a channel
 *  message. Each one breaks out of a different context: element content,
 *  a double-quoted attribute, a single-quoted attribute, and a self-closing
 *  tag that needs no closing tag to fire. */
const PAYLOADS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `'><svg/onload=alert(1)>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
];

/** Message text that autolinking has to refuse or defuse. Each one tries to
 *  turn the anchor the cards now emit into an injection point: a scheme that
 *  executes, a quote that closes the href, or markup wrapped around a URL
 *  that is otherwise perfectly valid. */
const LINK_PAYLOADS = [
  `javascript:alert(1)`,
  `data:text/html,<script>alert(1)</script>`,
  `https://evil.example/"><script>alert(1)</script>`,
  `https://evil.example/' onmouseover='alert(1)`,
  `<script>https://evil.example/</script>`,
  `https://evil.example/<img src=x onerror=alert(1)>`,
];

const INJECTED_SELECTOR = "script, img, iframe, object, embed, link, base";
const EVENT_ATTRS = ["onerror", "onload", "onclick", "onmouseover", "onfocus", "ontoggle"];

/** SVG is otherwise forbidden in card-generated markup. The signal history
 *  sparkline is the sole exception, so pin its complete, inert DOM shape. */
function expectOnlyTrustedSparklines(root: ParentNode): void {
  for (const svg of Array.from(root.querySelectorAll("svg"))) {
    expect(svg.getAttribute("class")).toBe("metric-sparkline");
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 56");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(
      Array.from(svg.attributes, ({ name }) => name).sort()
    ).toEqual(
      ["aria-hidden", "class", "focusable", "preserveAspectRatio", "viewBox"].sort()
    );

    expect(svg.children).toHaveLength(1);
    const line = svg.children[0];
    expect(line.tagName.toLowerCase()).toBe("polyline");
    expect(line.getAttribute("class")).toBe("metric-sparkline-line");
    expect(line.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(
      Array.from(line.attributes, ({ name }) => name).sort()
    ).toEqual(["class", "points", "vector-effect"].sort());
    expect(line.children).toHaveLength(0);

    const points = line.getAttribute("points") ?? "";
    expect(points).toMatch(
      /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)+$/
    );
    for (const point of points.split(/\s+/)) {
      const [x, y] = point.split(",").map(Number);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(56);
    }
  }
}

/** Assert a crafted string reached the DOM as inert text: no element it named
 *  was created, and no inline handler it carried survived as an attribute. */
function expectNoInjection(root: ShadowRoot | null): void {
  expect(root).not.toBeNull();
  const card = root!.querySelector("ha-card");
  expect(card).not.toBeNull();
  expect(card!.querySelector(INJECTED_SELECTOR)).toBeNull();
  expectOnlyTrustedSparklines(card!);
  for (const element of Array.from(card!.querySelectorAll("*"))) {
    for (const attr of EVENT_ATTRS) {
      expect(element.hasAttribute(attr)).toBe(false);
    }
  }
}

/** The payload must still be *visible* — escaping, not silent stripping. */
function expectRenderedAsText(root: ShadowRoot | null, payload: string): void {
  expect(root!.querySelector("ha-card")!.textContent ?? "").toContain(payload);
}

/** Autolinked message text is the one place a card builds an anchor out of
 *  attacker-chosen bytes. Whatever ends up in the DOM must be an http(s) link
 *  that cannot reach back through `window.opener`. */
function expectSafeLinks(root: ShadowRoot | null): void {
  for (const anchor of Array.from(root!.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    expect(/^https?:\/\//i.test(href), href).toBe(true);
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel") ?? "").toContain("noopener");
  }
}

function expectNoInjectionWithin(root: ShadowRoot | null): void {
  expect(root).not.toBeNull();
  expect(root!.querySelector(INJECTED_SELECTOR)).toBeNull();
  expectOnlyTrustedSparklines(root!);
  for (const element of Array.from(root!.querySelectorAll("*"))) {
    for (const attr of EVENT_ATTRS) {
      expect(element.hasAttribute(attr)).toBe(false);
    }
  }
}

interface ShowDialogDetail {
  dialogTag: string;
  dialogImport: () => Promise<unknown>;
  dialogParams: Record<string, unknown>;
}

interface TestDialogElement extends HTMLElement {
  params: Record<string, unknown>;
}

function addEntity(
  hass: HomeAssistant,
  entityId: string,
  entityState: HassEntity,
  deviceId: string | null = NODE_DEVICE_ID
): void {
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
  const entry = registryEntry(deviceId);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
}

function renderCard(config: unknown, hass: HomeAssistant): MeshcoreCard {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config as MeshcoreCardConfig);
  card.hass = hass;
  return card;
}

async function openNeighborsDialog(card: MeshcoreCard): Promise<TestDialogElement> {
  let detail: ShowDialogDetail | undefined;
  card.addEventListener("show-dialog", (event) => {
    detail = (event as CustomEvent<ShowDialogDetail>).detail;
  }, { once: true });
  card.shadowRoot!.querySelector<HTMLElement>('[data-neighbors-dialog]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(detail).toBeDefined();
  await detail!.dialogImport();
  const dialog = document.createElement(detail!.dialogTag) as TestDialogElement;
  dialog.params = detail!.dialogParams;
  document.body.appendChild(dialog);
  return dialog;
}

describe("hostile advert names in the device card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each(PAYLOADS)("escapes a crafted node name: %s", (payload) => {
    // The meshcore-ha integration names the device from the advert, so a
    // hostile adv_name lands here verbatim.
    const hass = createHass();
    hass.devices[NODE_DEVICE_ID].name = payload;

    const card = renderCard({ target: { type: "node", id: payload } }, hass);

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it.each(PAYLOADS)("escapes a crafted neighbour adv_name: %s", async (payload) => {
    // The neighbour list resolves names from contact entities' `adv_name`,
    // which is the field the published attack abuses.
    const hass = createHass();
    addEntity(hass, "sensor.meshcore_spring_neighbor_aaaa01", state(12.5));
    addEntity(hass, "sensor.meshcore_spring_neighbor_aaaa01_seen", state(7));
    addEntity(
      hass,
      "binary_sensor.meshcore_aaaa01_contact",
      state("on", { adv_id: "aaaa01", adv_name: payload }),
      HUB_DEVICE_ID
    );

    const card = renderCard(
      { target: { type: "node", id: NODE_NAME } },
      hass
    );

    const dialog = await openNeighborsDialog(card);
    expectNoInjectionWithin(dialog.shadowRoot);
    expect(dialog.shadowRoot!.textContent ?? "").toContain(payload);
    expect(
      dialog.shadowRoot!.querySelector(".neighbor-name")?.textContent
    ).toBe(payload);
  });

  it.each(PAYLOADS)(
    "escapes a crafted display title and neighbor name in the popup: %s",
    async (payload) => {
      const hass = createHass();
      addEntity(
        hass,
        "sensor.meshcore_spring_neighbor_aaaa01",
        state(12.5, { secs_ago: 10, resolved_name: payload })
      );
      const card = renderCard(
        { target: { type: "node", id: NODE_NAME }, name: payload },
        hass
      );

      const dialog = await openNeighborsDialog(card);
      expectNoInjectionWithin(dialog.shadowRoot);
      expect(dialog.shadowRoot!.textContent ?? "").toContain(payload);
      expect(
        dialog.shadowRoot!.querySelector(".neighbor-name")?.textContent
      ).toBe(payload);
    }
  );

  it.each(PAYLOADS)("escapes crafted hub hardware metadata: %s", (payload) => {
    // hw_model and firmware_version are self-reported by the radio.
    const hass = createHass();
    hass.states[HUB_STATUS_ENTITY].attributes["hw_model"] = payload;
    hass.states[HUB_STATUS_ENTITY].attributes["firmware_version"] = payload;

    const card = renderCard(
      { target: { type: "hub", id: HUB_PUBKEY }, details_default_open: true },
      hass
    );

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it.each(PAYLOADS)("escapes a crafted MQTT server label: %s", (payload) => {
    const hass = createHass();
    addEntity(
      hass,
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_bridge`,
      state("on", { server: payload }),
      HUB_DEVICE_ID
    );

    const card = renderCard(
      { target: { type: "hub", id: HUB_PUBKEY }, details_default_open: true },
      hass
    );

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it.each(PAYLOADS)(
    "escapes crafted route text in a Details chip title: %s",
    (payload) => {
      const hass = createHass();
      const routeEntity = `${NODE_PREFIX}out_path${NODE_SUFFIX}`;
      addEntity(hass, routeEntity, state(payload));

      const card = renderCard(
        { target: { type: "node", id: NODE_NAME }, details_default_open: true },
        hass
      );

      const chip = card.shadowRoot!.querySelector<HTMLElement>(
        `[data-entity="${routeEntity}"]`
      );
      expect(chip).not.toBeNull();
      expect(chip!.textContent ?? "").toContain(payload);
      expect(chip!.getAttribute("title")).toBe(`Route ${payload}`);
      expectNoInjection(card.shadowRoot);
    }
  );

  it.each(PAYLOADS)(
    "escapes a crafted route carried on the contact entity's attributes: %s",
    (payload) => {
      // The routing fallback reads straight off a contact advert, so an
      // attacker-chosen `out_path` reaches markup without passing through any
      // sensor state the integration might have sanitised.
      const hass = createRoutingContactHass({ out_path: payload, out_path_len: 1 });
      const routeEntity = `${NODE_PREFIX}out_path${NODE_SUFFIX}`;
      addEntity(hass, routeEntity, state("unknown"));

      const card = renderCard(
        { target: { type: "node", id: NODE_NAME }, details_default_open: true },
        hass
      );

      // The contact also backs the header and the routing badge, so pick the
      // Details chip by its label rather than taking the first match.
      const chip = Array.from(
        card.shadowRoot!.querySelectorAll<HTMLElement>(
          `.detail-chips [data-entity="${NODE_CONTACT_ENTITY}"]`
        )
      ).find((el) => el.querySelector(".chip-label")?.textContent?.trim() === "Route");
      expect(chip).not.toBeUndefined();
      expect(chip!.textContent ?? "").toContain(payload);
      expectNoInjection(card.shadowRoot);
    }
  );

  it("escapes a crafted icon_color without letting it break out of style", () => {
    // icon_color is interpolated into an inline style attribute, where HTML
    // escaping alone would not stop a CSS declaration break-out.
    const hass = createHass();
    const card = renderCard(
      {
        target: { type: "node", id: NODE_NAME },
        icon_color: `red;background:url(javascript:alert(1))`,
      },
      hass
    );

    const shape = card.shadowRoot!.querySelector(".device-icon-shape");
    expect(shape?.getAttribute("style") ?? "").not.toContain("javascript");
    expectNoInjection(card.shadowRoot);
  });

  it("allows only the trusted sparkline SVG when Recorder history is hostile", async () => {
    const hass = createHass();
    const now = Date.now() / 1000;
    const rssiId = `${NODE_PREFIX}last_rssi${NODE_SUFFIX}`;
    const snrId = `${NODE_PREFIX}last_snr${NODE_SUFFIX}`;
    const noiseId = `${NODE_PREFIX}noise_floor${NODE_SUFFIX}`;
    hass.callWS = vi.fn().mockResolvedValue({
      [rssiId]: [
        { s: "-62.5", lu: now - 7200 },
        { s: `-40\" onload=\"alert(1)`, lu: now - 5400 },
        { s: "-48", lu: now - 3600 },
      ],
      [snrId]: [
        { s: "3.5", lu: now - 7200 },
        { s: "Infinity", lu: now - 5400 },
        { s: "11", lu: now - 3600 },
      ],
      [noiseId]: [
        { s: "-118", lu: now - 7200 },
        { s: "NaN", lu: now - 5400 },
        { s: "-112", lu: now - 3600 },
      ],
      [`\"><svg onload=alert(1)>`]: [
        { s: `0,0\"/><script>alert(1)</script>`, lu: now - 1 },
      ],
    }) as HomeAssistant["callWS"];

    const card = renderCard(
      { target: { type: "node", id: NODE_NAME } },
      hass
    );
    document.body.appendChild(card);
    (card as unknown as { _lastRender: number })._lastRender = 0;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hass.callWS).toHaveBeenCalledTimes(1);
    expect(card.shadowRoot!.querySelectorAll("svg")).toHaveLength(3);
    expectNoInjection(card.shadowRoot);
    expect(card.shadowRoot!.innerHTML).not.toContain("Infinity");
    expect(card.shadowRoot!.innerHTML).not.toContain("NaN");
  });
});

describe("hostile channel traffic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function renderChannelMessage(
    message: string,
    config: Partial<MeshcoreChannelCardConfig> = {}
  ): Promise<MeshcoreChannelCard> {
    const callbacks: Array<(message: unknown) => void> = [];
    const connection = {
      subscribeMessage: vi.fn((callback: (message: unknown) => void) => {
        callbacks.push(callback);
        return Promise.resolve(vi.fn());
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as NonNullable<HomeAssistant["connection"]>;

    const hass = createChannelHass();
    hass.connection = connection;

    const card = document.createElement(
      "mushroom-meshcore-channel-card"
    ) as MeshcoreChannelCard;
    card.setConfig({
      entity: CHANNEL_ENTITY,
      ...config,
    } as MeshcoreChannelCardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);

    callbacks[0]!({
      events: [
        {
          when: Math.floor(Date.now() / 1000),
          name: "Channel",
          entity_id: CHANNEL_ENTITY,
          message,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(300);
    return card;
  }

  it.each(PAYLOADS)("escapes a crafted sender and body: %s", async (payload) => {
    // Both halves of the wire format are attacker-chosen.
    const card = await renderChannelMessage(`<Public> ${payload}: ${payload}`);

    expectNoInjection(card.shadowRoot);
    // `parseMessage` splits sender from body on the first colon, which some
    // payloads carry themselves, so assert on the rendered text as a whole:
    // the point is that the payload survives as inert text, not where the
    // sender/body boundary happened to fall.
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it.each(LINK_PAYLOADS)("never autolinks a hostile URL: %s", async (payload) => {
    const card = await renderChannelMessage(`<Public> Mallory: ${payload}`);

    expectNoInjection(card.shadowRoot);
    expectSafeLinks(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it("autolinks an ordinary URL without altering the visible text", async () => {
    const card = await renderChannelMessage(
      "<Public> Mallory: repeater map at https://example.com/map?a=1&b=2 today"
    );

    const link = card.shadowRoot!.querySelector<HTMLAnchorElement>(
      ".message-body a.message-link"
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com/map?a=1&b=2");
    expect(link!.textContent).toBe("https://example.com/map?a=1&b=2");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.shadowRoot!.querySelector(".message-body")!.textContent).toBe(
      "repeater map at https://example.com/map?a=1&b=2 today"
    );
  });

  it.each([
    ["see https://example.com/x for the map", "https://example.com/x"],
    ["https://example.com:8443/map", "https://example.com:8443/map"],
    ["see https://example.com:8443/a:b now", "https://example.com:8443/a:b"],
    ["https://example.com/x: neat", "https://example.com/x"],
  ])("autolinks a body-only message: %s", async (body, href) => {
    // No colon inside a URL — scheme, port, or path — may be read as the
    // sender separator, or the URL arrives split across two fields and never
    // linkifies.
    const card = await renderChannelMessage(`<Public> ${body}`);

    expect(card.shadowRoot!.querySelector(".message-sender")).toBeNull();
    const rendered = card.shadowRoot!.querySelector(".message-body")!;
    expect(rendered.textContent).toBe(body);
    expect(
      rendered.querySelector("a.message-link")!.getAttribute("href")
    ).toBe(href);
  });

  it("renders the URL as plain text when hide_links is set", async () => {
    const card = await renderChannelMessage(
      "<Public> Mallory: see https://example.com/map",
      { hide_links: true }
    );

    const body = card.shadowRoot!.querySelector(".message-body")!;
    expect(body.querySelector("a")).toBeNull();
    expect(body.textContent).toBe("see https://example.com/map");
  });
});

describe("hostile mention text", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function renderMention(
    item: Record<string, unknown>,
    config: Partial<MeshcoreMentionsCardConfig> = {}
  ): Promise<MeshcoreMentionsCard> {
    const callbacks: Array<(message: { items: unknown[] }) => void> = [];
    const connection = {
      subscribeMessage: vi.fn((callback: (message: { items: unknown[] }) => void) => {
        callbacks.push(callback);
        return Promise.resolve(vi.fn());
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as NonNullable<HomeAssistant["connection"]>;

    const hass = createHass();
    const todo = state("1", { friendly_name: "MeshCore Tags", supported_features: 4 });
    todo.entity_id = TODO_ENTITY;
    hass.states[TODO_ENTITY] = todo;
    hass.connection = connection;
    hass.callService = vi.fn().mockResolvedValue(undefined);

    const card = document.createElement(
      "mushroom-meshcore-mentions-card"
    ) as MeshcoreMentionsCard;
    card.setConfig({
      entity: TODO_ENTITY,
      ...config,
    } as MeshcoreMentionsCardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);

    callbacks[0]!({ items: [{ status: "needs_action", ...item }] });
    await vi.advanceTimersByTimeAsync(0);
    return card;
  }

  it.each(PAYLOADS)("escapes a crafted summary and description: %s", async (payload) => {
    // The to-do item is built by the integration from a mesh message, so the
    // sender, the channel, and the body are all attacker-chosen.
    const card = await renderMention({
      uid: "mention-a",
      summary: `${payload} on ${payload}: ${payload}`,
      description: payload,
    });

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
    expect(
      card.shadowRoot!.querySelector(".mention-description")!.textContent
    ).toBe(payload);
  });

  it.each(LINK_PAYLOADS)("never autolinks a hostile URL: %s", async (payload) => {
    const card = await renderMention({
      uid: "mention-a",
      summary: `Mallory on Public: ${payload}`,
    });

    expectNoInjection(card.shadowRoot);
    expectSafeLinks(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it("autolinks an ordinary URL in the mention message", async () => {
    const card = await renderMention({
      uid: "mention-a",
      summary: "Mallory on Public: ping https://example.com/x now",
    });

    const link = card.shadowRoot!.querySelector<HTMLAnchorElement>(
      ".mention-message a.message-link"
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com/x");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.shadowRoot!.querySelector(".mention-message")!.textContent).toBe(
      "ping https://example.com/x now"
    );
  });

  it("autolinks an unparsed summary too", async () => {
    const card = await renderMention({
      uid: "mention-a",
      summary: "no sender here https://example.com/x",
    });

    const fallback = card.shadowRoot!.querySelector(".mention-fallback")!;
    expect(fallback.querySelector("a.message-link")).not.toBeNull();
    expectSafeLinks(card.shadowRoot);
  });

  it("renders the URL as plain text when hide_links is set", async () => {
    const card = await renderMention(
      { uid: "mention-a", summary: "Mallory on Public: see https://example.com/x" },
      { hide_links: true }
    );

    const message = card.shadowRoot!.querySelector(".mention-message")!;
    expect(message.querySelector("a")).toBeNull();
    expect(message.textContent).toBe("see https://example.com/x");
  });
});
