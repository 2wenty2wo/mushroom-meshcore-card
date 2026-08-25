import { describe, expect, it } from "vitest";
import { renderTileHeader, type TileHeaderOptions } from "../src/tile-header.js";

const baseOptions: TileHeaderOptions = {
  displayName: "Spring Farm",
  secondary: "Online",
  icon: "mdi:radio-tower",
  active: true,
  primaryEntityId: "sensor.primary",
};

describe("renderTileHeader", () => {
  it("renders the discovered identity by default", () => {
    const html = renderTileHeader(undefined, baseOptions);
    expect(html).toContain('<span slot="primary">Spring Farm</span>');
    expect(html).toContain('<span slot="secondary">Online</span>');
    expect(html).toContain('icon="mdi:radio-tower"');
    expect(html).toContain('aria-label="Spring Farm, Online"');
  });

  it("applies name and icon overrides from the config", () => {
    const html = renderTileHeader(
      { name: "Farm Repeater", icon: "mdi:antenna" },
      baseOptions
    );
    expect(html).toContain('<span slot="primary">Farm Repeater</span>');
    expect(html).toContain('icon="mdi:antenna"');
    expect(html).not.toContain("Spring Farm");
  });

  it("is an interactive button with the primary entity attached", () => {
    const html = renderTileHeader(undefined, baseOptions);
    expect(html).toContain('<button class="device-header clickable"');
    expect(html).toContain('data-action-scope="header"');
    expect(html).toContain('data-entity="sensor.primary"');
    expect(html).toContain("<ha-ripple>");
  });

  it("degrades to a plain group without entity or actions", () => {
    const html = renderTileHeader(undefined, { ...baseOptions, primaryEntityId: null });
    expect(html).toContain('<div class="device-header "');
    expect(html).toContain('role="group"');
    expect(html).not.toContain("data-entity=");
    expect(html).not.toContain("<ha-ripple>");
  });

  it("stays interactive when only an action is configured", () => {
    const html = renderTileHeader(
      { tap_action: { action: "navigate", navigation_path: "/x" } },
      { ...baseOptions, primaryEntityId: null }
    );
    expect(html).toContain("<button");
    expect(html).not.toContain("data-entity=");
  });

  it("treats action none as non-interactive", () => {
    const html = renderTileHeader(
      { tap_action: { action: "none" } },
      { ...baseOptions, primaryEntityId: null }
    );
    expect(html).toContain('role="group"');
  });

  describe("icon_color", () => {
    it("resolves Mushroom color names to theme variables while active", () => {
      const html = renderTileHeader({ icon_color: "deep-purple" }, baseOptions);
      expect(html).toContain("--mushroom-meshcore-icon-override-color:var(--deep-purple-color)");
      expect(html).toContain("color-mix(in srgb, var(--deep-purple-color) 20%, transparent)");
    });

    it("passes raw CSS colors through", () => {
      const html = renderTileHeader({ icon_color: "#a1b2c3" }, baseOptions);
      expect(html).toContain("--mushroom-meshcore-icon-override-color:#a1b2c3");
    });

    it("drops unsafe color values entirely", () => {
      const html = renderTileHeader(
        { icon_color: "red;background:url(evil)" },
        baseOptions
      );
      expect(html).not.toContain("style=");
      expect(html).not.toContain("evil");
    });

    it("keeps the muted treatment while inactive", () => {
      const html = renderTileHeader({ icon_color: "red" }, { ...baseOptions, active: false });
      expect(html).not.toContain("--mushroom-meshcore-icon-override-color");
    });
  });

  describe("offline badge", () => {
    it("marks inactive targets with the default badge", () => {
      const html = renderTileHeader(undefined, { ...baseOptions, active: false });
      expect(html).toContain('class="device-header-row offline"');
      expect(html).toContain('class="icon-badge"');
      expect(html).toContain('icon="mdi:signal-off"');
    });

    it("uses the card-specific badge icon when provided", () => {
      const html = renderTileHeader(undefined, {
        ...baseOptions,
        active: false,
        inactiveBadgeIcon: "mdi:message-off",
      });
      expect(html).toContain('icon="mdi:message-off"');
    });

    it("shows no badge while active", () => {
      const html = renderTileHeader(undefined, baseOptions);
      expect(html).not.toContain("icon-badge");
    });
  });

  it("escapes externally sourced names", () => {
    const html = renderTileHeader(undefined, {
      ...baseOptions,
      displayName: `<img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("omits the secondary line when empty", () => {
    const html = renderTileHeader(undefined, { ...baseOptions, secondary: "" });
    expect(html).not.toContain('slot="secondary"');
    expect(html).toContain('aria-label="Spring Farm"');
  });
});
