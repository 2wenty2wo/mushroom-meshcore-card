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
  NODE_DEVICE_ID,
  NODE_NAME,
  createChannelHass,
  createHass,
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

const INJECTED_SELECTOR = "script, img, svg, iframe, object, embed, link, base";
const EVENT_ATTRS = ["onerror", "onload", "onclick", "onmouseover", "onfocus", "ontoggle"];

/** Assert a crafted string reached the DOM as inert text: no element it named
 *  was created, and no inline handler it carried survived as an attribute. */
function expectNoInjection(root: ShadowRoot | null): void {
  expect(root).not.toBeNull();
  const card = root!.querySelector("ha-card");
  expect(card).not.toBeNull();
  expect(card!.querySelector(INJECTED_SELECTOR)).toBeNull();
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

describe("hostile advert names in the device card", () => {
  it.each(PAYLOADS)("escapes a crafted node name: %s", (payload) => {
    // The meshcore-ha integration names the device from the advert, so a
    // hostile adv_name lands here verbatim.
    const hass = createHass();
    hass.devices[NODE_DEVICE_ID].name = payload;

    const card = renderCard({ target: { type: "node", id: payload } }, hass);

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

  it.each(PAYLOADS)("escapes a crafted neighbour adv_name: %s", (payload) => {
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
      { target: { type: "node", id: NODE_NAME }, details_default_open: true },
      hass
    );

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
  });

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

  it.each(PAYLOADS)("escapes a crafted sender and body: %s", async (payload) => {
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
    card.setConfig({ entity: CHANNEL_ENTITY } as MeshcoreChannelCardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);

    // Both halves of the wire format are attacker-chosen.
    callbacks[0]!({
      events: [
        {
          when: Math.floor(Date.now() / 1000),
          name: "Channel",
          entity_id: CHANNEL_ENTITY,
          message: `<Public> ${payload}: ${payload}`,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(300);

    expectNoInjection(card.shadowRoot);
    // `parseMessage` splits sender from body on the first colon, which some
    // payloads carry themselves, so assert on the rendered text as a whole:
    // the point is that the payload survives as inert text, not where the
    // sender/body boundary happened to fall.
    expectRenderedAsText(card.shadowRoot, payload);
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

  it.each(PAYLOADS)("escapes a crafted summary and description: %s", async (payload) => {
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
    card.setConfig({ entity: TODO_ENTITY } as MeshcoreMentionsCardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);

    // The to-do item is built by the integration from a mesh message, so the
    // sender, the channel, and the body are all attacker-chosen.
    callbacks[0]!({
      items: [
        {
          uid: "mention-a",
          summary: `${payload} on ${payload}: ${payload}`,
          status: "needs_action",
          description: payload,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);

    expectNoInjection(card.shadowRoot);
    expectRenderedAsText(card.shadowRoot, payload);
    expect(
      card.shadowRoot!.querySelector(".mention-description")!.textContent
    ).toBe(payload);
  });
});
