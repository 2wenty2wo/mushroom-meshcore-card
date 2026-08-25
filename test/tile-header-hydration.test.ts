// The upgrade-deferral path of hydrateTileInfo needs a custom-element
// registry where ha-tile-info is not yet defined. Element definitions cannot
// be undone, so this lives in its own file (and environment), keeping every
// test independent of execution order — the synchronous path is covered in
// tile-header.test.ts.
import { describe, expect, it } from "vitest";
import { hydrateTileInfo, renderTileHeader } from "../src/tile-header.js";

describe("hydrateTileInfo before the element upgrade", () => {
  it("waits for the ha-tile-info upgrade before applying properties", async () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = renderTileHeader(undefined, {
      displayName: "Spring Farm",
      secondary: "Online",
      icon: "mdi:radio-tower",
      active: true,
      primaryEntityId: "sensor.primary",
    });
    expect(customElements.get("ha-tile-info")).toBeUndefined();

    hydrateTileInfo(root);
    const info = root.querySelector("ha-tile-info") as HTMLElement & {
      primary?: string;
      secondary?: string;
    };
    expect(info.primary).toBeUndefined();

    customElements.define("ha-tile-info", class extends HTMLElement {});
    await customElements.whenDefined("ha-tile-info");
    await Promise.resolve();
    expect(info.primary).toBe("Spring Farm");
    expect(info.secondary).toBe("Online");
  });
});
