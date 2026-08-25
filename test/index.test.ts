import { describe, expect, it, vi } from "vitest";

describe("card registration", () => {
  it("defines all four custom elements and announces both cards", async () => {
    await import("../src/index.js");
    expect(customElements.get("mushroom-meshcore-card")).toBeDefined();
    expect(customElements.get("mushroom-meshcore-card-editor")).toBeDefined();
    expect(customElements.get("mushroom-meshcore-channel-card")).toBeDefined();
    expect(
      customElements.get("mushroom-meshcore-channel-card-editor")
    ).toBeDefined();

    const types = window.customCards.map((card) => card.type);
    expect(types).toContain("mushroom-meshcore-card");
    expect(types).toContain("mushroom-meshcore-channel-card");
    for (const entry of window.customCards) {
      expect(entry.name).toBeTruthy();
      expect(entry.preview).toBe(true);
      expect(entry.documentationURL).toContain("mushroom-meshcore-card");
    }
  });

  it("does not re-register elements or duplicate picker entries on reload", async () => {
    await import("../src/index.js");
    const cardCtor = customElements.get("mushroom-meshcore-card");
    const entries = window.customCards.length;
    vi.resetModules();
    await import("../src/index.js");
    expect(customElements.get("mushroom-meshcore-card")).toBe(cardCtor);
    expect(window.customCards.length).toBe(entries);
  });
});
