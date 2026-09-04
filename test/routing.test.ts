// Hop resolution. Each case is built so that a plausible wrong implementation
// fails it: the decoy contact defeats substring matching, the tie-break fixture
// lists the wrong repeater first so take-first is caught, and the interior-hop
// case would pass if neighbours were consulted everywhere.
import { describe, expect, it } from "vitest";
import { ROUTE_STYLES, renderRouteHops, resolveRouteHops } from "../src/routing.js";
import type { DiscoveredContact } from "../src/discovery.js";

const contact = (
  publicKey: string,
  name: string,
  entityId = `binary_sensor.meshcore_${name.toLowerCase().replace(/\W+/g, "_")}_contact`
): DiscoveredContact => ({ publicKey, name, entityId });

/** The live Gilead case: token 28 matches three contacts, one of which is a
 *  neighbour. Mayfield is deliberately first. */
const MAYFIELD = contact("28BA06BE0540", "Mayfield backup");
const MOUNT_ANNAN_RPT = contact("28C222747E12", "Mount Annan Rpt");
const VK1MCG = contact("283F570A8C66", "VK1MCG");
/** Contains "28" but is not reached through it. */
const DECOY = contact("FF28AA000000", "Decoy");

const THREE_WAY = [MAYFIELD, MOUNT_ANNAN_RPT, VK1MCG, DECOY];

describe("resolveRouteHops", () => {
  it("names a hop matching exactly one contact", () => {
    const hops = resolveRouteHops(["E9"], [contact("E963CBC8ACC7", "Mount Annan 2")], []);
    expect(hops).toEqual([
      {
        token: "E9",
        kind: "resolved",
        name: "Mount Annan 2",
        entityId: "binary_sensor.meshcore_mount_annan_2_contact",
      },
    ]);
  });

  it("matches on a prefix, never a substring", () => {
    // DECOY contains "28"; only a substring implementation would reach it.
    const hops = resolveRouteHops(["28"], [DECOY], []);
    expect(hops[0]!.kind).toBe("unknown");
  });

  it("breaks a three-way tie using the node's neighbours", () => {
    const hops = resolveRouteHops(["28"], THREE_WAY, ["28c222"]);
    expect(hops[0]).toEqual({
      token: "28",
      kind: "resolved",
      name: "Mount Annan Rpt",
      entityId: "binary_sensor.meshcore_mount_annan_rpt_contact",
    });
  });

  it("matches uppercase tokens against lowercase neighbour IDs", () => {
    // Tokens arrive uppercased from splitRoutePath; neighbour IDs come from
    // entity IDs and are lowercase. Comparing them raw matches nothing.
    const lower = resolveRouteHops(["28"], THREE_WAY, ["28c222"]);
    const upper = resolveRouteHops(["28"], THREE_WAY, ["28C222"]);
    expect(lower).toEqual(upper);
    expect(lower[0]!.kind).toBe("resolved");
  });

  it("stays ambiguous when no neighbour narrows the candidates", () => {
    const hops = resolveRouteHops(["28"], THREE_WAY, ["ffffff"]);
    expect(hops[0]).toEqual({
      token: "28",
      kind: "ambiguous",
      candidates: ["Mayfield backup", "Mount Annan Rpt", "VK1MCG"],
      total: 3,
    });
  });

  it("stays ambiguous when two candidates are both neighbours", () => {
    const hops = resolveRouteHops(["28"], THREE_WAY, ["28c222", "28ba06"]);
    expect(hops[0]!.kind).toBe("ambiguous");
  });

  it("leaves an interior hop ambiguous even when it matches a neighbour", () => {
    // Index 1 of 3 is adjacent to some other node, so this node's neighbours
    // say nothing about it and a match there would be coincidence.
    const hops = resolveRouteHops(["AA", "28", "BB"], THREE_WAY, ["28c222"]);
    expect(hops[1]!.kind).toBe("ambiguous");
  });

  it("narrows either end of a two-hop path", () => {
    const first = resolveRouteHops(["28", "BB"], THREE_WAY, ["28c222"]);
    expect(first[0]!.kind).toBe("resolved");
    const last = resolveRouteHops(["BB", "28"], THREE_WAY, ["28c222"]);
    expect(last[1]!.kind).toBe("resolved");
  });

  it("lists at most three candidates and reports the true total", () => {
    const many = [
      contact("2800000000AA", "One"),
      contact("2800000000BB", "Two"),
      contact("2800000000CC", "Three"),
      contact("2800000000DD", "Four"),
      contact("2800000000EE", "Five"),
    ];
    expect(resolveRouteHops(["28"], many, [])[0]).toEqual({
      token: "28",
      kind: "ambiguous",
      candidates: ["One", "Two", "Three"],
      total: 5,
    });
  });

  it("reports a hop no contact answers for as unknown", () => {
    expect(resolveRouteHops(["7F"], THREE_WAY, ["28c222"])[0]).toEqual({
      token: "7F",
      kind: "unknown",
    });
  });

  it("never names a hop from neighbour data alone", () => {
    // A neighbour narrows a contact set; it is not itself a source of names.
    // With no contacts there is nothing to narrow, so the hop is unknown.
    expect(resolveRouteHops(["28"], [], ["28c222"])[0]!.kind).toBe("unknown");
  });

  it("resolves every hop of a multi-hop path independently", () => {
    const hops = resolveRouteHops(
      ["E9", "7F"],
      [contact("E963CBC8ACC7", "Mount Annan 2")],
      []
    );
    expect(hops.map((hop) => hop.kind)).toEqual(["resolved", "unknown"]);
  });

  it("returns nothing for a direct or flood route", () => {
    expect(resolveRouteHops([], THREE_WAY, ["28c222"])).toEqual([]);
  });
});

describe("renderRouteHops styling", () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    vars?.["n"] === undefined ? key : `${key}:${vars["n"]}`;

  it("styles the hop link itself rather than borrowing the card's chip rules", () => {
    // The same markup renders inside the dialog's shadow root, which sees
    // neither `.chip` nor the custom properties it reads.
    const html = renderRouteHops(
      [{ token: "28", kind: "resolved", name: "Mount Annan Rpt", entityId: "binary_sensor.x" }],
      t
    );
    expect(html).toContain("route-hop-link");
    expect(html).not.toMatch(/class="[^"]*\bchip\b/);
    expect(ROUTE_STYLES).toContain("button.route-hop-link");
  });

  it("gives every custom property a literal fallback", () => {
    // A token with no fallback resolves to nothing outside the card.
    const withoutFallback = ROUTE_STYLES.match(/var\(--[a-z-]+\)/g) ?? [];
    expect(withoutFallback).toEqual([]);
  });
});
