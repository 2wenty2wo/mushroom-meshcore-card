import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MeshcoreStatusBadge,
  statusBadgeAccessibleSummary,
  statusBadgeSummary,
  statusDialogSections,
} from "../src/status-badge.js";
import {
  ensureStatusDialog,
  MushroomMeshcoreStatusDialog,
} from "../src/status-dialog.js";
import { buildStatusSnapshot } from "../src/status-model.js";
import { makeLocalize } from "../src/localize.js";
import type {
  HomeAssistant,
  MeshcoreStatusBadgeConfig,
} from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  HUB_STATUS_ENTITY,
  NODE_DEVICE_ID,
  NODE_ONLINE_ENTITY,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  defineOnce,
  registryEntry,
  state,
} from "./fixtures.js";

defineOnce("mushroom-meshcore-status-badge", MeshcoreStatusBadge);

const t = makeLocalize("en");
const target = { type: "hub", id: HUB_PUBKEY } as const;

function addEntity(
  hass: HomeAssistant,
  entityId: string,
  value: unknown,
  deviceId: string,
  attributes: Record<string, unknown> = {}
): void {
  const entityState = state(value, attributes);
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
  const entry = registryEntry(deviceId);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
}

function statusHass(nodeState = "on"): HomeAssistant {
  const hass = createHass();
  addEntity(hass, NODE_ONLINE_ENTITY, nodeState, NODE_DEVICE_ID);
  return hass;
}

function createBadge(
  config: MeshcoreStatusBadgeConfig = { target },
  hass: HomeAssistant = statusHass()
): MeshcoreStatusBadge {
  const badge = document.createElement(
    "mushroom-meshcore-status-badge"
  ) as MeshcoreStatusBadge;
  badge.setConfig(config);
  badge.hass = hass;
  document.body.appendChild(badge);
  return badge;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Status badge summaries", () => {
  it("reports healthy, unknown, warning with unknown coverage, and critical states", () => {
    const healthyHass = statusHass();
    expect(
      statusBadgeSummary(buildStatusSnapshot(healthyHass, HUB_PUBKEY)!, t)
    ).toBe("1/1 online");

    const unknownHass = statusHass("unknown");
    expect(
      statusBadgeSummary(buildStatusSnapshot(unknownHass, HUB_PUBKEY)!, t)
    ).toBe(t("card.status_unknown"));

    const warningHass = statusHass();
    warningHass.states[
      `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`
    ]!.state = "40";
    const mqttUnknown =
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_0_connection_test_hub`;
    addEntity(warningHass, mqttUnknown, "unknown", HUB_DEVICE_ID);
    const warning = buildStatusSnapshot(warningHass, HUB_PUBKEY)!;
    expect(statusBadgeSummary(warning, t)).toBe("1 issue · 1 unknown");
    expect(statusBadgeAccessibleSummary(warning, t)).toContain(
      `${t("card.status_low_batteries")}: 1`
    );

    const offlineHass = statusHass("off");
    offlineHass.states[HUB_STATUS_ENTITY]!.state = "offline";
    expect(
      statusBadgeSummary(buildStatusSnapshot(offlineHass, HUB_PUBKEY)!, t)
    ).toBe(t("card.status_hub_offline"));
  });

  it("uses Hub online rather than 0/0 for an empty managed fleet", () => {
    const hass = statusHass();
    for (const [entityId, entry] of Object.entries(hass.entities)) {
      if (entry.device_id === NODE_DEVICE_ID) {
        delete hass.entities[entityId];
        delete hass.states[entityId];
      }
    }
    delete hass.devices[NODE_DEVICE_ID];
    expect(
      statusBadgeSummary(buildStatusSnapshot(hass, HUB_PUBKEY)!, t)
    ).toBe(t("card.status_hub_online"));
  });
});

describe("MeshcoreStatusBadge", () => {
  it("renders localized unconfigured and unresolved states without selecting a hub", () => {
    const unconfigured = createBadge({});
    expect(unconfigured.shadowRoot!.textContent).toContain(
      t("card.status_select_hub_prompt")
    );
    const unresolved = createBadge({
      target: { type: "hub", id: "badcafe" },
    });
    expect(unresolved.shadowRoot!.textContent).toContain("badcafe");
    expect(MeshcoreStatusBadge.getStubConfig()).toEqual({});
    expect(MeshcoreStatusBadge.getConfigElement().localName).toBe(
      "mushroom-meshcore-status-badge-editor"
    );
    expect("getGridOptions" in unconfigured).toBe(false);

    const malformed = createBadge({
      target: { type: "hub", id: 42 } as unknown as typeof target,
    });
    expect(malformed.shadowRoot!.textContent).toContain(
      t("card.status_select_hub_prompt")
    );
  });

  it("ignores malformed non-array exclusions like the shared status model", () => {
    const hass = statusHass();
    hass.devices[NODE_DEVICE_ID]!.name = "S";
    const badge = createBadge(
      {
        target,
        excluded_nodes: "S",
      } as unknown as MeshcoreStatusBadgeConfig,
      hass
    );
    expect(badge.shadowRoot!.textContent).toContain("1/1 online");
  });

  it("renders native ha-badge content, friendly hub identity, and healthy override color", () => {
    const badge = createBadge({
      target,
      name: "East mesh",
      icon: "mdi:antenna",
      icon_color: "teal",
    });
    const nativeBadge = badge.shadowRoot!.querySelector("ha-badge")!;
    expect(nativeBadge.getAttribute("label")).toBe("East mesh");
    expect(nativeBadge.textContent).toContain("1/1 online");
    expect(nativeBadge.querySelector("ha-icon")?.getAttribute("icon")).toBe(
      "mdi:antenna"
    );
    expect(badge.shadowRoot!.innerHTML).toContain(
      "--status-badge-healthy-color:var(--teal-color)"
    );
  });

  it("opens compact status details by default", () => {
    const hass = statusHass();
    hass.states[`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`]!.state = "40";
    const badge = createBadge({ target }, hass);
    const seen: Array<Record<string, unknown>> = [];
    badge.addEventListener("show-dialog", (event) => {
      seen.push(
        (event as CustomEvent<{ dialogParams: Record<string, unknown> }>).detail
      );
    });
    const button = badge.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    button.click();
    expect(seen).toHaveLength(1);
    expect(seen[0]!["dialogTag"]).toBe("mushroom-meshcore-status-dialog");
    const params = seen[0]!["dialogParams"] as {
      sections: Array<{ id: string; rows: unknown[] }>;
    };
    expect(params.sections.map((section) => section.id)).toEqual([
      "low_battery",
    ]);
  });

  it("lets an explicit tap action replace the dialog and explicit none disable tap", () => {
    const push = vi.spyOn(history, "pushState").mockImplementation(() => {});
    const navigates = createBadge({
      target,
      tap_action: { action: "navigate", navigation_path: "/lovelace/mesh" },
    });
    const dialog = vi.fn();
    navigates.addEventListener("show-dialog", dialog);
    navigates.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    expect(push).toHaveBeenCalledWith(null, "", "/lovelace/mesh");
    expect(dialog).not.toHaveBeenCalled();

    const warningHass = statusHass();
    warningHass.states[
      `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`
    ]!.state = "40";
    const disabled = createBadge(
      {
        target,
        icon_color: "teal",
        tap_action: { action: "none" },
      },
      warningHass
    );
    expect(disabled.shadowRoot!.querySelector("button")).toBeNull();
    const status = disabled.shadowRoot!.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-label")).toContain(
      `${t("card.status_low_batteries")}: 1`
    );
    expect(status.className).toContain("warning");
    expect(status.getAttribute("style")).toBeNull();
  });

  it("runs an independently configured hold action", () => {
    vi.useFakeTimers();
    const hass = statusHass();
    const callService = vi.fn();
    hass.callService = callService;
    const badge = createBadge(
      {
        target,
        tap_action: { action: "none" },
        hold_action: {
          action: "perform-action",
          perform_action: "script.status_hold",
        },
      },
      hass
    );
    const button = badge.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    vi.advanceTimersByTime(500);
    button.dispatchEvent(new Event("pointerup", { bubbles: true, composed: true }));
    expect(callService).toHaveBeenCalledWith(
      "script",
      "status_hold",
      undefined,
      undefined
    );
  });

  it("delays the default dialog while an explicit double tap is possible", () => {
    vi.useFakeTimers();
    const hass = statusHass();
    const callService = vi.fn();
    hass.callService = callService;
    const badge = createBadge({
      target,
      double_tap_action: {
        action: "perform-action",
        perform_action: "script.double",
      },
    }, hass);
    const showDialog = vi.fn();
    badge.addEventListener("show-dialog", showDialog);
    const button = badge.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    button.click();
    expect(showDialog).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(showDialog).toHaveBeenCalledTimes(1);

    button.click();
    vi.advanceTimersByTime(100);
    button.click();
    expect(callService).toHaveBeenCalledWith(
      "script",
      "double",
      undefined,
      undefined
    );
  });

  it("escapes configured content and unsafe icon colors", () => {
    const badge = createBadge({
      target,
      name: '<img src=x onerror="boom">',
      icon_color: "red;display:none",
    });
    expect(badge.shadowRoot!.querySelector("img")).toBeNull();
    expect(badge.shadowRoot!.innerHTML).not.toContain("display:none");
    expect(
      badge.shadowRoot!.querySelector("ha-badge")?.getAttribute("label")
    ).toBe('<img src=x onerror="boom">');
  });

  it("cleans up a throttled render when removed", () => {
    vi.useFakeTimers();
    const badge = createBadge();
    badge.hass = statusHass();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    badge.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Status details dialog", () => {
  it("contains issues and unknowns only, with escaped clickable rows", () => {
    const hass = statusHass();
    hass.states[`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`]!.state = "40";
    const mqttUnknown =
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_0_connection_test_hub`;
    addEntity(hass, mqttUnknown, "unknown", HUB_DEVICE_ID, {
      server: '<img src=x onerror="boom">',
    });
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    const sections = statusDialogSections(snapshot, t);
    expect(sections.map((section) => section.id)).toEqual([
      "low_battery",
      "unknown_checks",
    ]);

    ensureStatusDialog();
    const dialog = document.createElement(
      "mushroom-meshcore-status-dialog"
    ) as MushroomMeshcoreStatusDialog;
    const source = document.createElement("button");
    const moreInfoDestination = document.createElement("button");
    document.body.append(source, moreInfoDestination, dialog);
    dialog.showDialog({
      title: "Mesh status",
      sections,
      emptyLabel: "Clear",
      closeLabel: "Close",
      returnFocus: source,
    });
    expect(dialog.shadowRoot!.querySelector("img")).toBeNull();
    const row = dialog.shadowRoot!.querySelector<HTMLButtonElement>(
      `[data-entity="${NODE_PREFIX}battery_percentage${NODE_SUFFIX}"]`
    )!;
    const moreInfo = vi.fn();
    dialog.addEventListener("hass-more-info", moreInfo);
    dialog.addEventListener("hass-more-info", () => moreInfoDestination.focus());
    row.click();
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect(
      (moreInfo.mock.calls[0]![0] as CustomEvent).detail.entityId
    ).toBe(`${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`);
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(moreInfoDestination);
  });

  it("removes the fallback dialog and restores focus when it closes", () => {
    ensureStatusDialog();
    const source = document.createElement("button");
    const dialog = document.createElement(
      "mushroom-meshcore-status-dialog"
    ) as MushroomMeshcoreStatusDialog;
    document.body.append(source, dialog);
    source.focus();
    dialog.showDialog({
      title: "Mesh status",
      sections: [],
      emptyLabel: "Clear",
      closeLabel: "Close",
      returnFocus: source,
    });
    const nativeDialog = dialog.shadowRoot!.querySelector("dialog")!;
    nativeDialog.dispatchEvent(new Event("close"));
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(source);
  });

  it("uses Home Assistant's adaptive dialog branch when available", async () => {
    if (!customElements.get("ha-adaptive-dialog")) {
      class TestAdaptiveDialog extends HTMLElement {
        width: "small" | "medium" | "large" | "full" = "small";
        headerTitle?: string;
        private _open = false;

        get open(): boolean {
          return this._open;
        }

        set open(value: boolean) {
          this._open = value;
          if (!value) {
            Promise.resolve().then(() =>
              this.dispatchEvent(new Event("closed"))
            );
          }
        }
      }
      customElements.define("ha-adaptive-dialog", TestAdaptiveDialog);
    }

    const source = document.createElement("button");
    const dialog = document.createElement(
      "mushroom-meshcore-status-dialog"
    ) as MushroomMeshcoreStatusDialog;
    document.body.append(source, dialog);
    source.focus();
    dialog.showDialog({
      title: "Adaptive mesh status",
      sections: [],
      emptyLabel: "Clear",
      closeLabel: "Close",
      returnFocus: source,
    });
    const adaptive = dialog.shadowRoot!.querySelector("ha-adaptive-dialog") as
      | (HTMLElement & {
          open: boolean;
          width: string;
          headerTitle?: string;
        })
      | null;
    expect(adaptive).not.toBeNull();
    expect(adaptive!.open).toBe(true);
    expect(adaptive!.width).toBe("small");
    expect(adaptive!.headerTitle).toBe("Adaptive mesh status");
    dialog.closeDialog();
    await Promise.resolve();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(source);
  });

  it("does not steal focus after an adaptive row opens more-info", async () => {
    const source = document.createElement("button");
    const moreInfoDestination = document.createElement("button");
    const dialog = document.createElement(
      "mushroom-meshcore-status-dialog"
    ) as MushroomMeshcoreStatusDialog;
    document.body.append(source, moreInfoDestination, dialog);
    source.focus();
    dialog.showDialog({
      title: "Adaptive mesh status",
      sections: [
        {
          id: "offline",
          title: "Offline",
          severity: "warning",
          rows: [
            {
              id: "node",
              name: "Spring Farm",
              entityId: NODE_ONLINE_ENTITY,
              severity: "warning",
            },
          ],
        },
      ],
      emptyLabel: "Clear",
      closeLabel: "Close",
      returnFocus: source,
    });
    dialog.addEventListener("hass-more-info", () => moreInfoDestination.focus());
    dialog.shadowRoot!
      .querySelector<HTMLButtonElement>(`[data-entity="${NODE_ONLINE_ENTITY}"]`)!
      .click();
    expect(document.activeElement).toBe(moreInfoDestination);
    await Promise.resolve();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(moreInfoDestination);
  });
});
