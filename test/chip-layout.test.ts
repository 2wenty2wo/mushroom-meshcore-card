import { describe, expect, it } from "vitest";
import { defaultChipLayout, effectiveChipLayout } from "../src/chip-layout.js";
import type { MeshcoreCardConfig } from "../src/types.js";

const NODE = { type: "node", id: "Test" } as const;
const HUB = { type: "hub", id: "abc123" } as const;

describe("chip layouts", () => {
  it("keeps current defaults and adds neighbor count for nodes", () => {
    expect(defaultChipLayout(NODE).top).toEqual([
      "sent", "received", "temperature", "uptime", "neighbor_count",
    ]);
    expect(defaultChipLayout(HUB).top).toEqual(["hardware", "firmware"]);
  });

  it("honors legacy quick-stat and firmware settings without a layout", () => {
    const firmware = effectiveChipLayout(NODE, { show_firmware: true });
    expect(firmware.top[0]).toBe("firmware");
    const hidden = effectiveChipLayout(NODE, { hide_quick_stats: true });
    expect(hidden.top).toEqual([]);
    expect(hidden.hidden).toContain("neighbor_count");
  });

  it("normalizes duplicates, unknown values, and omissions", () => {
    const config = {
      chip_layout: {
        top: ["received", "received", "not_a_chip"],
        details: ["sent", "received"],
        hidden: [],
      },
    } as unknown as MeshcoreCardConfig;
    const layout = effectiveChipLayout(NODE, config);
    expect(layout.top).toEqual(["received"]);
    expect(layout.details).toEqual(["sent"]);
    expect(layout.hidden).toContain("firmware");
    expect(layout.hidden).toContain("neighbor_count");
  });

  it("treats malformed non-array YAML zones as empty", () => {
    const config = {
      chip_layout: {
        top: null,
        details: {},
        hidden: "firmware",
      },
    } as unknown as MeshcoreCardConfig;
    const layout = effectiveChipLayout(NODE, config);
    expect(layout.top).toEqual([]);
    expect(layout.details).toEqual([]);
    expect(layout.hidden).toEqual(expect.arrayContaining([
      "firmware", "sent", "received", "neighbor_count",
    ]));
  });
});
