import { describe, expect, it } from "vitest";
import {
  MeshcoreChannelCard,
  normalizedPositiveNumber,
  parseChannel,
  parseMessage,
} from "../src/channel-card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreChannelCardConfig } from "../src/types.js";
import {
  CHANNEL_ENTITY,
  createChannelHass,
  defineOnce,
  shadowBody,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-channel-card", MeshcoreChannelCard);

const t = makeLocalize("en");

function renderChannelCard(
  config: unknown,
  hass: HomeAssistant = createChannelHass()
): { card: MeshcoreChannelCard; body: string } {
  const card = document.createElement(
    "mushroom-meshcore-channel-card"
  ) as MeshcoreChannelCard;
  card.setConfig(config as MeshcoreChannelCardConfig);
  card.hass = hass;
  return { card, body: shadowBody(card) };
}

describe("parseMessage", () => {
  it("strips one channel prefix and splits the sender at the first colon", () => {
    expect(parseMessage("<Public> Alice: hello world")).toEqual({
      sender: "Alice",
      body: "hello world",
    });
  });

  it("only strips a single leading channel prefix", () => {
    expect(parseMessage("<Public> <b>bold?</b> no colon here")).toEqual({
      sender: null,
      body: "<b>bold?</b> no colon here",
    });
  });

  it("keeps later colons in the body", () => {
    expect(parseMessage("Alice: note: meet at 10:30")).toEqual({
      sender: "Alice",
      body: "note: meet at 10:30",
    });
  });

  it("preserves line breaks in the body", () => {
    expect(parseMessage("<Ch> Alice: line one\nline two: still body")).toEqual({
      sender: "Alice",
      body: "line one\nline two: still body",
    });
  });

  it("removes exactly one space after the sender colon", () => {
    expect(parseMessage("Alice:no-space")).toEqual({ sender: "Alice", body: "no-space" });
    expect(parseMessage("Alice:  padded")).toEqual({ sender: "Alice", body: " padded" });
  });

  it("treats colon-less messages as body-only", () => {
    expect(parseMessage("<Public> just an announcement")).toEqual({
      sender: null,
      body: "just an announcement",
    });
  });

  it("does not emphasise an empty or leading-colon sender", () => {
    expect(parseMessage(":starts with colon")).toEqual({
      sender: null,
      body: ":starts with colon",
    });
    expect(parseMessage("   : spaced colon")).toEqual({
      sender: null,
      body: "   : spaced colon",
    });
  });

  it("rejects blank messages and bare channel prefixes", () => {
    expect(parseMessage("")).toBeNull();
    expect(parseMessage("   ")).toBeNull();
    expect(parseMessage("<Public>")).toBeNull();
    expect(parseMessage("  <Public>  ")).toBeNull();
  });
});

describe("parseChannel", () => {
  it("reads the channel name from a fully-qualified friendly name", () => {
    expect(
      parseChannel(CHANNEL_ENTITY, {
        friendly_name: "MeshCore Hub One (edfaf6) Public Messages",
      })
    ).toEqual({ channelName: "Public" });
  });

  it("strips the discovered hub name from short friendly names", () => {
    expect(
      parseChannel(
        CHANNEL_ENTITY,
        { friendly_name: "🌳 Test Hub (HA) #general Messages" },
        "🌳 Test Hub (HA)"
      )
    ).toEqual({ channelName: "#general" });
  });

  it("keeps a short friendly name that has no hub prefix", () => {
    expect(
      parseChannel(CHANNEL_ENTITY, { friendly_name: "Public Messages" })
    ).toEqual({ channelName: "Public" });
  });

  it("falls back to the channel index from the entity id", () => {
    expect(
      parseChannel("binary_sensor.meshcore_edfaf6_ch_3_messages", {})
    ).toEqual({ channelName: "Ch 3" });
  });

  it("falls back to the channel_index attribute for unrecognised ids", () => {
    expect(parseChannel("binary_sensor.custom", { channel_index: 2 })).toEqual({
      channelName: "Ch 2",
    });
  });
});

describe("normalizedPositiveNumber", () => {
  it("accepts finite numbers of at least one", () => {
    expect(normalizedPositiveNumber(1, 24)).toBe(1);
    expect(normalizedPositiveNumber(2.5, 24)).toBe(2.5);
    expect(normalizedPositiveNumber(500, 24)).toBe(500);
  });

  it("falls back for everything else", () => {
    expect(normalizedPositiveNumber(undefined, 24)).toBe(24);
    expect(normalizedPositiveNumber(0, 24)).toBe(24);
    expect(normalizedPositiveNumber(-3, 24)).toBe(24);
    expect(normalizedPositiveNumber(0.5, 24)).toBe(24);
    expect(normalizedPositiveNumber("12", 24)).toBe(24);
    expect(normalizedPositiveNumber(Number.NaN, 24)).toBe(24);
    expect(normalizedPositiveNumber(Number.POSITIVE_INFINITY, 24)).toBe(24);
  });
});

describe("channel card config validation", () => {
  it("prompts for a channel when no entity is configured", () => {
    const { body } = renderChannelCard({});
    expect(body).toContain(t("card.select_channel_prompt"));
  });

  it("rejects entities that are not channel message sensors", () => {
    const hass = createChannelHass();
    hass.states["sensor.not_a_channel"] = state("on");
    const { body } = renderChannelCard({ entity: "sensor.not_a_channel" }, hass);
    expect(body).toContain("sensor.not_a_channel");
    expect(body).toContain("was not found");
  });

  it("rejects channel entities that have no state", () => {
    const { body } = renderChannelCard({
      entity: "binary_sensor.meshcore_ffffff_ch_9_messages",
    });
    expect(body).toContain("was not found");
  });

  it("renders the resolved channel with hub name stripped", () => {
    const { body } = renderChannelCard({ entity: CHANNEL_ENTITY });
    expect(body).toContain('<span slot="primary">Public</span>');
    expect(body).toContain(t("card.active"));
    expect(body).toContain('class="channel-history"');
    expect(body).toContain(t("card.channel_history_loading"));
  });

  it("shows the unavailable state with the muted message badge", () => {
    const hass = createChannelHass({ channelState: "unavailable" });
    const { body } = renderChannelCard({ entity: CHANNEL_ENTITY }, hass);
    expect(body).toContain(t("card.unavailable"));
    expect(body).toContain('icon="mdi:message-off"');
  });

  it("applies the configured name override", () => {
    const { body } = renderChannelCard({ entity: CHANNEL_ENTITY, name: "Mesh Chat" });
    expect(body).toContain('<span slot="primary">Mesh Chat</span>');
  });

  it("ships an empty stub config", () => {
    expect(MeshcoreChannelCard.getStubConfig()).toEqual({});
  });
});
