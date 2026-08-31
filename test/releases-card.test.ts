import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshcoreReleasesCard } from "../src/releases-card.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HomeAssistant,
  MeshcoreReleasesCardConfig,
} from "../src/types.js";
import { createHass, defineOnce, shadowBody, state } from "./fixtures.js";

defineOnce("mushroom-meshcore-releases-card", MeshcoreReleasesCard);

const MESHCORE = "sensor.meshcore_latest_release";
const MISHMESH = "sensor.mishmesh_latest_release";
const ZEPHCORE = "sensor.zephcore_latest_release";
const t = makeLocalize("en");

function releaseState(
  tag: string,
  publishedAt: string | null,
  overrides: Record<string, unknown> = {}
) {
  return state(tag, {
    friendly_name: `${tag} release`,
    html_url: `https://example.com/releases/${encodeURIComponent(tag)}`,
    ...(publishedAt ? { published_at: publishedAt } : {}),
    prerelease: false,
    ...overrides,
  });
}

function createReleaseHass(
  overrides: Record<string, ReturnType<typeof state>> = {}
): HomeAssistant {
  return createHass({
    extraStates: {
      [MESHCORE]: releaseState("v1.17.1", "2026-08-20T00:00:00Z", {
        friendly_name: "MeshCore Latest Release",
      }),
      [MISHMESH]: releaseState("mishmesh-v1.4.1", "2026-08-28T00:00:00Z", {
        friendly_name: "mishmesh Latest Release",
      }),
      [ZEPHCORE]: releaseState("1.17.3-zephcore", "2026-08-25T00:00:00Z", {
        friendly_name: "ZephCore Latest Release",
      }),
      ...overrides,
    },
  });
}

function createCard(
  config: MeshcoreReleasesCardConfig = {
    sources: [
      { entity: MESHCORE, name: "MeshCore" },
      { entity: MISHMESH, name: "mishmesh" },
      { entity: ZEPHCORE, name: "ZephCore" },
    ],
  },
  hass = createReleaseHass()
): MeshcoreReleasesCard {
  const card = document.createElement(
    "mushroom-meshcore-releases-card"
  ) as MeshcoreReleasesCard;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  return card;
}

function rowNames(card: MeshcoreReleasesCard): string[] {
  return Array.from(card.shadowRoot!.querySelectorAll(".release-name")).map(
    (element) => element.textContent ?? ""
  );
}

function headerSecondary(card: MeshcoreReleasesCard): string {
  return (
    card.shadowRoot!.querySelector<HTMLElement>('[slot="secondary"]')
      ?.textContent ?? ""
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T00:00:00Z"));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("MeshcoreReleasesCard", () => {
  it("waits for config and hass, then prompts for explicit sources", () => {
    const card = new MeshcoreReleasesCard();
    card.setConfig({ sources: [] });
    expect(card.shadowRoot!.innerHTML).toBe("");
    card.hass = createReleaseHass();
    expect(shadowBody(card)).toContain(t("card.releases_select_sources"));
  });

  it("renders a neutral Tile header and compact newest-first release rows", () => {
    const card = createCard();
    expect(card.shadowRoot!.querySelector("ha-tile-info")).not.toBeNull();
    expect(shadowBody(card)).toContain("--mushroom-meshcore-icon-override-color");
    expect(rowNames(card)).toEqual(["mishmesh", "ZephCore", "MeshCore"]);
    expect(card.shadowRoot!.querySelectorAll(".release-row")).toHaveLength(3);
    expect(card.shadowRoot!.querySelector(".release-age")?.textContent).toBe(
      "3 days ago"
    );
  });

  it("supports configured and localized name sorting", () => {
    const sources = [
      { entity: MESHCORE, name: "Zulu" },
      { entity: MISHMESH, name: "alpha" },
      { entity: ZEPHCORE, name: "Beta" },
    ];
    expect(rowNames(createCard({ sources, sort: "configured" }))).toEqual([
      "Zulu",
      "alpha",
      "Beta",
    ]);
    expect(rowNames(createCard({ sources, sort: "name" }))).toEqual([
      "alpha",
      "Beta",
      "Zulu",
    ]);
  });

  it.each(["configured", "name"] as const)(
    "reports the actual newest release when rows are sorted by %s order",
    (sort) => {
      const card = createCard({
        sources: [
          { entity: MESHCORE, name: "Alpha" },
          { entity: MISHMESH, name: "Zulu" },
          { entity: ZEPHCORE, name: "Beta" },
        ],
        sort,
      });
      expect(rowNames(card)[0]).toBe("Alpha");
      expect(headerSecondary(card)).toBe("3 sources · newest 3 days ago");
    }
  );

  it("omits the newest age when no source has a valid publication date", () => {
    const card = createCard(
      undefined,
      createReleaseHass({
        [MESHCORE]: releaseState("v1", "invalid"),
        [MISHMESH]: releaseState("v2", null),
        [ZEPHCORE]: releaseState("v3", "not-a-date"),
      })
    );
    expect(headerSecondary(card)).toBe("3 sources");
  });

  it("sorts invalid dates last and preserves configured order for ties", () => {
    const hass = createReleaseHass({
      [MESHCORE]: releaseState("v1", "invalid"),
      [MISHMESH]: releaseState("v2", "2026-08-28T00:00:00Z"),
      [ZEPHCORE]: releaseState("v3", "2026-08-28T00:00:00Z"),
    });
    const card = createCard(
      {
        sources: [
          { entity: ZEPHCORE, name: "ZephCore" },
          { entity: MESHCORE, name: "MeshCore" },
          { entity: MISHMESH, name: "mishmesh" },
        ],
      },
      hass
    );
    expect(hass.states[ZEPHCORE]?.attributes["published_at"]).toBe(
      "2026-08-28T00:00:00Z"
    );
    expect(hass.states[MISHMESH]?.attributes["published_at"]).toBe(
      "2026-08-28T00:00:00Z"
    );
    expect(rowNames(card)).toEqual(["ZephCore", "mishmesh", "MeshCore"]);
    expect(card.shadowRoot!.querySelectorAll(".release-age")[2]?.textContent).toBe(
      t("card.releases_unknown_age")
    );
  });

  it("deduplicates sources and falls back through friendly name to entity ID", () => {
    const missingFriendly = releaseState("v2", "2026-08-28T00:00:00Z", {
      friendly_name: "",
    });
    const card = createCard(
      {
        sources: [
          { entity: MISHMESH, name: "First" },
          { entity: MISHMESH, name: "Duplicate" },
          { entity: ZEPHCORE },
        ],
        sort: "configured",
      },
      createReleaseHass({ [ZEPHCORE]: missingFriendly })
    );
    expect(rowNames(card)).toEqual(["First", ZEPHCORE]);
  });

  it("keeps unavailable and unresolved sources as muted rows", () => {
    const unavailable = releaseState("unavailable", null);
    const card = createCard(
      {
        sources: [
          { entity: MESHCORE, name: "MeshCore" },
          { entity: MISHMESH, name: "mishmesh" },
          { entity: "sensor.missing_release", name: "Missing" },
        ],
      },
      createReleaseHass({ [MISHMESH]: unavailable })
    );
    expect(card.shadowRoot!.querySelectorAll(".release-row.unavailable")).toHaveLength(2);
    expect(shadowBody(card)).toContain("1 of 3 available");
    expect(shadowBody(card)).not.toContain(">unavailable<");
    expect(shadowBody(card)).toContain(`>${t("card.unavailable")}<`);
    const list = card.shadowRoot!.querySelector<HTMLElement>('[role="list"]')!;
    expect(
      Array.from(list.children).every(
        (item) => item.getAttribute("role") === "listitem"
      )
    ).toBe(true);
    expect(card.shadowRoot!.querySelector(".release-row[role='listitem']")).toBeNull();
    expect(list.children[0]?.querySelector("a.release-row")).not.toBeNull();
    expect(list.children[1]?.querySelector("a")).toBeNull();
  });

  it("renders prerelease state and safe HTTPS rows as external links", () => {
    const card = createCard(
      { sources: [{ entity: MISHMESH, name: "mishmesh" }] },
      createReleaseHass({
        [MISHMESH]: releaseState("v2-beta", "2026-08-30T00:00:00Z", {
          prerelease: true,
          html_url: "https://github.com/example/project/releases/tag/v2-beta",
        }),
      })
    );
    const link = card.shadowRoot!.querySelector<HTMLAnchorElement>(".release-row");
    expect(link?.href).toBe(
      "https://github.com/example/project/releases/tag/v2-beta"
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
    expect(link?.textContent).toContain(t("card.releases_prerelease"));
    expect(link?.getAttribute("role")).toBeNull();
    expect(link?.parentElement?.getAttribute("role")).toBe("listitem");
    expect(link?.parentElement?.parentElement?.getAttribute("role")).toBe("list");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,boom",
    "http://example.com/release",
    "not a URL",
  ])("rejects unsafe release URL %s", (htmlUrl) => {
    const card = createCard(
      { sources: [{ entity: MESHCORE, name: "MeshCore" }] },
      createReleaseHass({
        [MESHCORE]: releaseState("v1", "2026-08-20T00:00:00Z", {
          html_url: htmlUrl,
        }),
      })
    );
    expect(card.shadowRoot!.querySelector("a.release-row")).toBeNull();
  });

  it("escapes untrusted names, tags, and attributes", () => {
    const payload = `<img src=x onerror=alert(1)>`;
    const card = createCard(
      { sources: [{ entity: MESHCORE, name: payload }] },
      createReleaseHass({
        [MESHCORE]: releaseState(payload, "2026-08-20T00:00:00Z", {
          html_url: `https://example.com/\" onmouseover=\"alert(1)`,
        }),
      })
    );
    expect(card.shadowRoot!.querySelector("img")).toBeNull();
    expect(card.shadowRoot!.querySelector("[onerror], [onmouseover]")).toBeNull();
    expect(card.shadowRoot!.textContent).toContain(payload);
  });

  it("hides age text without dropping prerelease or link information", () => {
    const card = createCard({
      sources: [{ entity: MISHMESH, name: "mishmesh" }],
      hide_age: true,
    });
    expect(card.shadowRoot!.querySelector(".release-age")).toBeNull();
    expect(shadowBody(card)).not.toContain("newest");
    expect(card.shadowRoot!.querySelector("a.release-row")).not.toBeNull();
  });

  it("updates relative ages every minute and stops the timer on disconnect", async () => {
    const clearInterval = vi.spyOn(window, "clearInterval");
    const hass = createReleaseHass({
      [MESHCORE]: releaseState("v1", "2026-08-30T23:59:00Z"),
    });
    const card = createCard(
      { sources: [{ entity: MESHCORE, name: "MeshCore" }] },
      hass
    );
    expect(card.shadowRoot!.querySelector(".release-age")?.textContent).toBe(
      "1 minute ago"
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(card.shadowRoot!.querySelector(".release-age")?.textContent).toBe(
      "2 minutes ago"
    );
    card.remove();
    expect(clearInterval).toHaveBeenCalled();
  });

  it("uses internal scrolling for constrained grid rows", () => {
    const card = createCard({
      sources: [{ entity: MESHCORE }],
      grid_options: { columns: "full", rows: 4 },
    });
    expect(card.shadowRoot!.querySelector("ha-card")?.classList).toContain(
      "grid-rows"
    );
    expect(card.getGridOptions()).toEqual({
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 1,
    });
  });
});
