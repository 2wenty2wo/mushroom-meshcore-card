import { describe, expect, it, vi } from "vitest";

describe("card registration", () => {
  it("defines the five card families and Status badge, then announces both surfaces", async () => {
    await import("../src/index.js");
    expect(customElements.get("mushroom-meshcore-card")).toBeDefined();
    expect(customElements.get("mushroom-meshcore-card-editor")).toBeDefined();
    expect(customElements.get("mushroom-meshcore-channel-card")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-channel-card-editor")
    ).toBeDefined();
    expect(customElements.get("mushroom-meshcore-mentions-card")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-mentions-card-editor")
    ).toBeDefined();
    expect(customElements.get("mushroom-meshcore-releases-card")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-releases-card-editor")
    ).toBeDefined();
    expect(customElements.get("mushroom-meshcore-status-card")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-status-card-editor")
    ).toBeDefined();
    expect(customElements.get("mushroom-meshcore-status-badge")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-status-badge-editor")
    ).toBeDefined();

    const types = window.customCards.map((card) => card.type);
    expect(types).toContain("mushroom-meshcore-card");
    expect(types).toContain("mushroom-meshcore-channel-card");
    expect(types).toContain("mushroom-meshcore-mentions-card");
    expect(types).toContain("mushroom-meshcore-releases-card");
    expect(types).toContain("mushroom-meshcore-status-card");
    for (const entry of window.customCards) {
      expect(entry.name).toBeTruthy();
      expect(entry.preview).toBe(true);
      expect(entry.documentationURL).toContain("mushroom-meshcore-card");
    }
    expect(window.customBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mushroom-meshcore-status-badge",
          name: expect.any(String),
          documentationURL: expect.stringContaining("cards/status"),
        }),
      ])
    );
  });

  it("does not re-register elements or duplicate picker entries on reload", async () => {
    await import("../src/index.js");
    const cardCtor = customElements.get("mushroom-meshcore-card");
    const entries = window.customCards.length;
    const badgeEntries = window.customBadges.length;
    vi.resetModules();
    await import("../src/index.js");
    expect(customElements.get("mushroom-meshcore-card")).toBe(cardCtor);
    expect(window.customCards.length).toBe(entries);
    expect(window.customBadges.length).toBe(badgeEntries);
  });
});
