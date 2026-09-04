// Routing state on the node card: which entity supplies `out_path_len`, how it
// is worded, and where it surfaces. Kept apart from repeater-metrics-2.9, which
// is about alias compatibility rather than what the value means.
import { describe, expect, it, vi } from "vitest";
import { MeshcoreCard } from "../src/card.js";
import { makeLocalize } from "../src/localize.js";
import type { HomeAssistant, MeshcoreCardConfig } from "../src/types.js";
import {
  HUB_DEVICE_ID,
  NODE_CONTACT_ENTITY,
  NODE_NAME,
  NODE_PREFIX,
  NODE_SUFFIX,
  OTHER_HUB_CONTACT_ENTITY,
  RENAMED_NODE_NAME,
  createHass,
  createMultiHubContactHass,
  createRenamedNodeHass,
  createRoutingContactHass,
  createV29RepeaterHass,
  defineOnce,
  device,
  shadowBody,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-card", MeshcoreCard);

const t = makeLocalize("en");
const NODE_TARGET = { target: { type: "node", id: NODE_NAME } };
const PATH_SENSOR = `${NODE_PREFIX}out_path_len${NODE_SUFFIX}`;
const ROUTE_SENSOR = `${NODE_PREFIX}out_path${NODE_SUFFIX}`;

function renderCard(config: unknown, hass: HomeAssistant) {
  const card = document.createElement("mushroom-meshcore-card") as MeshcoreCard;
  card.setConfig(config as MeshcoreCardConfig);
  card.hass = hass;
  return { card, body: shadowBody(card) };
}

/** The routing badge lives in the header row's trailing slot. */
function badge(card: MeshcoreCard): HTMLElement | null {
  return card.shadowRoot!.querySelector<HTMLElement>(".routing-badge");
}

function setSensor(hass: HomeAssistant, entityId: string, value: unknown): void {
  const next = state(value);
  next.entity_id = entityId;
  hass.states[entityId] = next;
}

describe("node routing state", () => {
  it("words the sentinel path lengths and hop counts from the sensor", () => {
    for (const [value, expected] of [
      [-1, t("card.path_flood")],
      [0, t("card.path_direct")],
      [1, t("card.path_hop_one")],
      [3, t("card.path_hops_count", { n: 3 })],
    ] as const) {
      const hass = createV29RepeaterHass();
      setSensor(hass, PATH_SENSOR, value);
      const { card } = renderCard({ ...NODE_TARGET, details_default_open: true }, hass);
      expect(badge(card)?.textContent, String(value)).toContain(expected);
      expect(badge(card)?.dataset["entity"], String(value)).toBe(PATH_SENSOR);
    }
  });

  it("falls back to the contact attribute when the sensor reads unknown", () => {
    // The case that motivated this: on most real nodes the per-node sensor sits
    // at `unknown` while the contact attribute stays live.
    const hass = createRoutingContactHass({ out_path: "", out_path_len: -1 });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard(NODE_TARGET, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
    expect(badge(card)?.dataset["entity"]).toBe(NODE_CONTACT_ENTITY);
  });

  it("uses the contact attribute when no path sensor exists at all", () => {
    const hass = createRoutingContactHass(
      { out_path: "a1b2", out_path_len: 2 },
      { sensors: false }
    );
    const { card } = renderCard(NODE_TARGET, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_hops_count", { n: 2 }));
    expect(badge(card)?.dataset["entity"]).toBe(NODE_CONTACT_ENTITY);
  });

  it("keeps the sensor authoritative when both carry a usable value", () => {
    const hass = createRoutingContactHass({ out_path: "ffff", out_path_len: 9 });
    setSensor(hass, PATH_SENSOR, 0);
    const { card } = renderCard(NODE_TARGET, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_direct"));
    expect(badge(card)?.dataset["entity"]).toBe(PATH_SENSOR);
  });

  it("renders no badge when neither source is readable", () => {
    for (const attr of ["", "unknown", "unavailable", 2.5, -4, "abc"]) {
      const hass = createRoutingContactHass({ out_path_len: attr });
      setSensor(hass, PATH_SENSOR, "unknown");
      const { card } = renderCard(NODE_TARGET, hass);
      expect(badge(card), String(attr)).toBeNull();
    }
  });

  it("still resolves routing when a location entity overrides the contact", () => {
    // `contactId` is deliberately nulled when location_entity is set; routing
    // must not inherit that gate.
    const hass = createRoutingContactHass({ out_path_len: 2 });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard(
      { ...NODE_TARGET, location_entity: "device_tracker.somewhere_else" },
      hass
    );
    expect(badge(card)?.textContent).toContain(t("card.path_hops_count", { n: 2 }));
  });

  it("translates the wording", () => {
    const de = makeLocalize("de");
    const hass = createV29RepeaterHass();
    hass.language = "de";
    hass.locale = { language: "de" };
    setSensor(hass, PATH_SENSOR, 0);
    const { card } = renderCard(NODE_TARGET, hass);
    expect(badge(card)?.textContent).toContain(de("card.path_direct"));
    expect(de("card.path_direct")).toBe("Direkt");
  });

  it("shows routing on an offline node, which is when it matters most", () => {
    const hass = createRoutingContactHass({ out_path_len: -1 }, { sensors: false });
    setSensor(hass, `${NODE_PREFIX}uptime${NODE_SUFFIX}`, "unavailable");
    const { card } = renderCard(NODE_TARGET, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
  });

  it("also sources the route chip from the contact attribute", () => {
    const hass = createRoutingContactHass({ out_path: "a1b2", out_path_len: 1 });
    setSensor(hass, ROUTE_SENSOR, "unknown");
    const { card } = renderCard({ ...NODE_TARGET, details_default_open: true }, hass);
    // The contact backs several surfaces here, so pick the chip by its label.
    const routeChip = Array.from(
      card.shadowRoot!.querySelectorAll<HTMLElement>(
        `.detail-chips [data-entity="${NODE_CONTACT_ENTITY}"]`
      )
    ).find((chip) => chip.querySelector(".chip-label")?.textContent?.trim() === t("card.routing_path"));
    expect(routeChip?.textContent).toContain("a1b2");
  });

  it("words the value in the quick-chip row too", () => {
    // The formatting lives in the view model, so every render site inherits it.
    const hass = createV29RepeaterHass();
    setSensor(hass, PATH_SENSOR, -1);
    const { body } = renderCard(
      { ...NODE_TARGET, chip_layout: { top: ["path_length"], details: [], hidden: [] } },
      hass
    );
    const quickRow = body.match(/<div class="quick-chip-row[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(quickRow).toContain(t("card.path_flood"));
  });

  it("re-renders when only the contact's routing attributes change", () => {
    // Frozen time makes the two fixtures byte-identical apart from the routing
    // attribute, so this fails if the fingerprint ignores it. An attribute-only
    // change moves last_updated but not last_changed, which is why the
    // fingerprint has to account for it explicitly.
    // Uses the renamed fixture deliberately: the fingerprint has to resolve the
    // contact the same way the renderer does, so matching it by name here would
    // go stale on exactly the devices the pubkey lookup was added for.
    vi.useFakeTimers();
    try {
      const hass = createRenamedNodeHass({ out_path_len: -1 });
      setSensor(hass, PATH_SENSOR, "unknown");
      const target = { target: { type: "node", id: RENAMED_NODE_NAME } };
      const { card } = renderCard(target, hass);
      expect(badge(card)?.textContent).toContain(t("card.path_flood"));

      const next = createRenamedNodeHass({ out_path_len: 1 });
      setSensor(next, PATH_SENSOR, "unknown");
      card.hass = next;
      vi.advanceTimersByTime(10_000); // clear the render throttle
      expect(badge(card)?.textContent).toContain(t("card.path_hop_one"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a contact filed on its own device beneath the node's hub", () => {
    // meshcore-ha may register a contact against a device of its own rather
    // than the hub directly. That is still hub-scoped, and `isDeviceOnHub` is
    // the shared predicate that says so.
    const hass = createRenamedNodeHass({ out_path_len: -1 });
    const contactDeviceId = "contact-own-device";
    hass.entities[NODE_CONTACT_ENTITY]!.device_id = contactDeviceId;
    hass.devices[contactDeviceId] = device(contactDeviceId, {
      name: "Spring Farm contact",
      via_device_id: HUB_DEVICE_ID,
    });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard({ target: { type: "node", id: RENAMED_NODE_NAME } }, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
    expect(badge(card)?.dataset["entity"]).toBe(NODE_CONTACT_ENTITY);
  });

  it("still rejects a contact filed beneath a different hub", () => {
    const hass = createRenamedNodeHass({ out_path_len: -1 });
    const strayDeviceId = "stray-device";
    hass.entities[NODE_CONTACT_ENTITY]!.device_id = strayDeviceId;
    hass.devices[strayDeviceId] = device(strayDeviceId, {
      name: "Other hub's child",
      via_device_id: "some-other-hub",
    });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard({ target: { type: "node", id: RENAMED_NODE_NAME } }, hass);
    expect(badge(card)).toBeNull();
  });

  it("reads routing from the node's own hub, not another that hears it", () => {
    // out_path is hub-relative, so the rival contact carries a different route
    // under the same pubkey.
    const hass = createMultiHubContactHass();
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard({ target: { type: "node", id: RENAMED_NODE_NAME } }, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
    expect(badge(card)?.dataset["entity"]).toBe(NODE_CONTACT_ENTITY);
    expect(badge(card)?.dataset["entity"]).not.toBe(OTHER_HUB_CONTACT_ENTITY);
  });

  it("leaves a node with no contact and no path sensor unbadged", () => {
    const { card } = renderCard(NODE_TARGET, createHass());
    expect(badge(card)).toBeNull();
  });

  it("matches the contact by pubkey when the device name is not the advert name", () => {
    // meshcore-ha names devices "MeshCore Repeater: <adv_name> (<pubkey>)", so
    // comparing the device name to adv_name never matches on real hardware and
    // the fallback would silently never fire.
    const hass = createRenamedNodeHass({ out_path_len: -1 });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard({ target: { type: "node", id: RENAMED_NODE_NAME } }, hass);
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
    expect(badge(card)?.dataset["entity"]).toBe(NODE_CONTACT_ENTITY);
  });

  it("does not match a contact whose pubkey belongs to another node", () => {
    const hass = createRenamedNodeHass({
      out_path_len: -1,
      pubkey_prefix: "ffffffffffff",
    });
    setSensor(hass, PATH_SENSOR, "unknown");
    const { card } = renderCard({ target: { type: "node", id: RENAMED_NODE_NAME } }, hass);
    expect(badge(card)).toBeNull();
  });

  it("honours a chip layout that hides path_length", () => {
    // Hidden means "do not show me this reading"; the badge is another place
    // the same value would otherwise surface.
    const hass = createV29RepeaterHass();
    setSensor(hass, PATH_SENSOR, -1);
    const { card } = renderCard(
      { ...NODE_TARGET, chip_layout: { top: [], details: [], hidden: ["path_length"] } },
      hass
    );
    expect(badge(card)).toBeNull();
  });

  it("keeps the badge when path_length is merely moved, not hidden", () => {
    const hass = createV29RepeaterHass();
    setSensor(hass, PATH_SENSOR, -1);
    const { card } = renderCard(
      { ...NODE_TARGET, chip_layout: { top: ["path_length"], details: [], hidden: [] } },
      hass
    );
    expect(badge(card)?.textContent).toContain(t("card.path_flood"));
  });
});
