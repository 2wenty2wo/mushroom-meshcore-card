import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOW_BATTERY_THRESHOLD,
  buildStatusSnapshot,
} from "../src/status-model.js";
import { normalizeConnectivityState } from "../src/entity-resolver.js";
import type { HassEntity, } from "home-assistant-js-websocket";
import type { HomeAssistant } from "../src/types.js";
import {
  HUB_DEVICE_ID,
  HUB_PUBKEY,
  HUB_STATUS_ENTITY,
  NODE_DEVICE_ID,
  NODE_NAME,
  NODE_ONLINE_ENTITY,
  NODE_PREFIX,
  NODE_SUFFIX,
  createHass,
  createV29RepeaterHass,
  device,
  registryEntry,
  state,
} from "./fixtures.js";

function addEntity(
  hass: HomeAssistant,
  entityId: string,
  value: unknown,
  deviceId: string,
  attributes: HassEntity["attributes"] = {}
): void {
  const entityState = state(value, attributes);
  entityState.entity_id = entityId;
  hass.states[entityId] = entityState;
  const entry = registryEntry(deviceId);
  entry.entity_id = entityId;
  hass.entities[entityId] = entry;
}

function onlineHass(): HomeAssistant {
  const hass = createHass();
  addEntity(hass, NODE_ONLINE_ENTITY, "on", NODE_DEVICE_ID, {
    last_successful_request: 1_700_000_000,
  });
  return hass;
}

function removeEntity(hass: HomeAssistant, entityId: string): void {
  delete hass.states[entityId];
  delete hass.entities[entityId];
}

describe("buildStatusSnapshot", () => {
  it("returns null rather than silently choosing a different hub", () => {
    expect(buildStatusSnapshot(onlineHass(), "missing")).toBeNull();
  });

  it("builds a healthy snapshot from managed child nodes", () => {
    const snapshot = buildStatusSnapshot(onlineHass(), HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("healthy");
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.unknownCount).toBe(0);
    expect(snapshot.monitoredCount).toBe(1);
    expect(snapshot.onlineCount).toBe(1);
    expect(snapshot.nodes.items[0]).toMatchObject({
      name: NODE_NAME,
      state: "online",
      entityId: NODE_ONLINE_ENTITY,
      lastSuccessfulRequest: 1_700_000_000,
    });
    expect(snapshot.lowBatteryThreshold).toBe(DEFAULT_LOW_BATTERY_THRESHOLD);
  });

  it("uses human-readable case-insensitive exclusions", () => {
    const snapshot = buildStatusSnapshot(onlineHass(), HUB_PUBKEY, {
      excludedNodes: ["  spring FARM "],
    })!;
    expect(snapshot.monitoredCount).toBe(0);
    expect(snapshot.severity).toBe("healthy");
  });

  it("excludes every duplicate matching node name", () => {
    const hass = onlineHass();
    const secondDeviceId = "node-device-two";
    hass.devices[secondDeviceId] = device(secondDeviceId, {
      name: NODE_NAME,
      via_device_id: HUB_DEVICE_ID,
    });
    addEntity(
      hass,
      "binary_sensor.meshcore_b2c3d4_online_spring_farm",
      "on",
      secondDeviceId
    );
    addEntity(
      hass,
      "sensor.meshcore_two_battery_percentage_spring_farm",
      90,
      secondDeviceId
    );
    expect(
      buildStatusSnapshot(hass, HUB_PUBKEY, { excludedNodes: [NODE_NAME] })!
        .monitoredCount
    ).toBe(0);
  });

  it("treats an explicit offline node as one warning", () => {
    const hass = onlineHass();
    hass.states[NODE_ONLINE_ENTITY]!.state = "off";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("warning");
    expect(snapshot.issueCount).toBe(1);
    expect(snapshot.offlineCount).toBe(1);
    expect(snapshot.findings[0]).toMatchObject({ kind: "node_offline" });
  });

  it("keeps unknown node checks separate from issues", () => {
    const hass = onlineHass();
    hass.states[NODE_ONLINE_ENTITY]!.state = "unknown";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    // An unreadable check is a gap in telemetry, not a sick hub.
    expect(snapshot.severity).toBe("healthy");
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.unknownCount).toBe(1);
    expect(snapshot.unknownChecks[0]).toMatchObject({ kind: "node_status" });
  });

  it("recognizes explicit legacy online/status states without using counters", () => {
    const hass = createHass();
    const legacy = `${NODE_PREFIX}online${NODE_SUFFIX}`;
    addEntity(hass, legacy, "offline", NODE_DEVICE_ID);
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.nodes.items[0]!.state).toBe("offline");
    expect(snapshot.findings[0]!.kind).toBe("node_offline");
  });

  it("suppresses cached downstream failures while the hub is offline", () => {
    const hass = onlineHass();
    hass.states[HUB_STATUS_ENTITY]!.state = "offline";
    hass.states[NODE_ONLINE_ENTITY]!.state = "off";
    addEntity(
      hass,
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_0_connection_test_hub`,
      "off",
      HUB_DEVICE_ID
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("critical");
    expect(snapshot.issueCount).toBe(1);
    expect(snapshot.findings.map((finding) => finding.kind)).toEqual([
      "hub_offline",
    ]);
    expect(snapshot.dependentChecksSuppressed).toBe(true);
    expect(snapshot.nodes.items).toEqual([]);
  });

  it("reports an unknown hub without converting it to offline", () => {
    const hass = onlineHass();
    hass.states[HUB_STATUS_ENTITY]!.state = "unavailable";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("unknown");
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.unknownChecks).toHaveLength(1);
    expect(snapshot.unknownChecks[0]!.kind).toBe("hub_status");
  });

  it("treats explicit status overrides as authoritative when missing or unavailable", () => {
    const hass = onlineHass();
    const unavailable = "sensor.authoritative_hub_status";
    const unavailableState = state("unavailable");
    unavailableState.entity_id = unavailable;
    hass.states[unavailable] = unavailableState;

    for (const statusEntity of ["sensor.missing_hub_status", unavailable]) {
      const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY, { statusEntity })!;
      expect(snapshot.hub.state).toBe("unknown");
      expect(snapshot.unknownChecks).toHaveLength(1);
      expect(snapshot.unknownChecks[0]).toMatchObject({
        kind: "hub_status",
        entityId: statusEntity,
      });
      expect(snapshot.dependentChecksSuppressed).toBe(true);
    }
  });

  it("normalizes only explicit connectivity states", () => {
    for (const value of ["on", "online", "connected", "true", "1", true, 1]) {
      expect(normalizeConnectivityState(value)).toBe("online");
    }
    for (const value of [
      "off",
      "offline",
      "disconnected",
      "false",
      "0",
      false,
      0,
    ]) {
      expect(normalizeConnectivityState(value)).toBe("offline");
    }
    for (const value of ["unknown", "unavailable", "yes", "no", "", null]) {
      expect(normalizeConnectivityState(value)).toBe("unknown");
    }
  });

  it("warns strictly below the configured 50 percent battery boundary", () => {
    const hass = onlineHass();
    const batteryId = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[batteryId]!.state = "49.9";
    let snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.findings[0]).toMatchObject({
      kind: "low_battery",
      value: 49.9,
      threshold: 50,
    });
    hass.states[batteryId]!.state = "50";
    snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.issueCount).toBe(0);
  });

  it("accepts numeric thresholds and falls back from invalid YAML values", () => {
    const hass = onlineHass();
    const batteryId = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[batteryId]!.state = "20";

    for (const threshold of [0, "0", 15, "15"] as const) {
      const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY, {
        lowBatteryThreshold: threshold as number,
      })!;
      expect(snapshot.lowBatteryThreshold).toBe(Number(threshold));
      expect(snapshot.issueCount).toBe(0);
    }

    for (const threshold of [
      null,
      "",
      "   ",
      true,
      false,
      500,
      "not-a-number",
    ] as const) {
      expect(
        buildStatusSnapshot(hass, HUB_PUBKEY, {
          lowBatteryThreshold: threshold as unknown as number,
        })!.lowBatteryThreshold
      ).toBe(DEFAULT_LOW_BATTERY_THRESHOLD);
    }
  });

  it("ignores hub zero, but treats node zero as a valid low battery", () => {
    const hass = onlineHass();
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_battery_percentage_test_hub`,
      0,
      HUB_DEVICE_ID,
      { unit_of_measurement: "%" }
    );
    const batteryId = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[batteryId]!.state = "0";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.hub.batteryPercent).toBeNull();
    expect(snapshot.findings).toHaveLength(1);
    expect(snapshot.findings[0]!.subject.type).toBe("node");
  });

  it("does not infer percentage from a voltage-only battery entity", () => {
    const hass = onlineHass();
    removeEntity(hass, `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`);
    addEntity(
      hass,
      `${NODE_PREFIX}battery${NODE_SUFFIX}`,
      4.1,
      NODE_DEVICE_ID,
      { unit_of_measurement: "V", device_class: "battery" }
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.nodes.items[0]!.batteryPercent).toBeNull();
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.unknownCount).toBe(0);
  });

  it("reports a selected percentage entity with invalid units as unknown", () => {
    const hass = onlineHass();
    const batteryId = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[batteryId]!.attributes["unit_of_measurement"] = "V";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.unknownChecks).toHaveLength(1);
    expect(snapshot.unknownChecks[0]).toMatchObject({
      kind: "battery_status",
      entityId: batteryId,
    });
  });

  it("reports missing and non-percentage explicit battery overrides as unknown", () => {
    const hass = onlineHass();
    const voltage = "sensor.hub_battery_voltage_override";
    const voltageState = state(4.1, { unit_of_measurement: "V" });
    voltageState.entity_id = voltage;
    hass.states[voltage] = voltageState;

    for (const batteryEntity of ["sensor.missing_hub_battery", voltage]) {
      const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY, {
        batteryEntity,
      })!;
      expect(snapshot.unknownChecks).toContainEqual(
        expect.objectContaining({
          kind: "battery_status",
          entityId: batteryEntity,
          subject: expect.objectContaining({ type: "hub" }),
        })
      );
    }
  });

  it("does not assess a cached battery while its node is offline", () => {
    const hass = onlineHass();
    hass.states[NODE_ONLINE_ENTITY]!.state = "off";
    const batteryId = `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`;
    hass.states[batteryId]!.state = "unavailable";
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.findings.map((finding) => finding.kind)).toEqual([
      "node_offline",
    ]);
    expect(snapshot.unknownCount).toBe(0);
  });

  it("parses MQTT explicitly instead of relying on string truthiness", () => {
    const hass = onlineHass();
    const disconnected =
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_0_connection_test_hub`;
    const unknown =
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_1_connection_test_hub`;
    addEntity(hass, disconnected, "off", HUB_DEVICE_ID, { server: "Primary" });
    addEntity(hass, unknown, "unavailable", HUB_DEVICE_ID, { server: "Backup" });
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.mqtt).toMatchObject({
      total: 2,
      disconnected: 1,
      unknown: 1,
    });
    expect(snapshot.issueCount).toBe(1);
    expect(snapshot.unknownCount).toBe(1);
    expect(snapshot.severity).toBe("warning");
  });

  it("does not mistake MQTT metadata sensors for connection state", () => {
    const hass = onlineHass();
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_port_test_hub`,
      1883,
      HUB_DEVICE_ID
    );
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_mqtt_backup_server_test_hub`,
      "mqtt.example",
      HUB_DEVICE_ID
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.mqtt.total).toBe(0);
    expect(snapshot.unknownCount).toBe(0);
  });

  it("counts each asserted latched radio flag and labels it by code", () => {
    const hass = onlineHass();
    for (const code of ["err_pool_full", "err_cad_timeout"] as const) {
      addEntity(
        hass,
        `binary_sensor.meshcore_${HUB_PUBKEY}_${code}_test_hub`,
        "on",
        HUB_DEVICE_ID
      );
    }
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.issueCount).toBe(2);
    expect(snapshot.groups.map((group) => group.kind)).toEqual(["radio_fault"]);
    expect(snapshot.groups[0]!.items.map((item) => item.radioCode)).toEqual([
      "err_pool_full",
      "err_cad_timeout",
    ]);
  });

  it("keeps queue and cumulative counters neutral", () => {
    const hass = createV29RepeaterHass();
    addEntity(hass, NODE_ONLINE_ENTITY, "on", NODE_DEVICE_ID);
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("healthy");
    expect(snapshot.issueCount).toBe(0);
    expect(snapshot.diagnostics.map((item) => item.metric)).toEqual([
      "tx_queue_len",
      "request_failures",
      "full_evts",
      "recv_errors",
      "recv_errors_rate",
    ]);
  });

  it("includes available hub self-diagnostics without changing severity", () => {
    const hass = onlineHass();
    const queue = `sensor.meshcore_${HUB_PUBKEY}_tx_queue_len_test_hub`;
    addEntity(hass, queue, 3, HUB_DEVICE_ID);
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("healthy");
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        id: `hub:${HUB_PUBKEY}:tx_queue_len`,
        subject: expect.objectContaining({
          type: "hub",
          id: HUB_PUBKEY,
          name: "Test Hub",
        }),
        metric: "tx_queue_len",
        entityId: queue,
      })
    );
  });

  it("matches the complete hub diagnostic metric before its name suffix", () => {
    const hass = onlineHass();
    const rate = `sensor.meshcore_${HUB_PUBKEY}_recv_errors_rate_test_hub`;
    addEntity(hass, rate, 0.25, HUB_DEVICE_ID);

    let snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        metric: "recv_errors_rate",
        entityId: rate,
      }),
    ]);

    const cumulative = `sensor.meshcore_${HUB_PUBKEY}_recv_errors_test_hub`;
    addEntity(hass, cumulative, 12, HUB_DEVICE_ID);
    snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        metric: "recv_errors",
        entityId: cumulative,
      }),
      expect.objectContaining({
        metric: "recv_errors_rate",
        entityId: rate,
      }),
    ]);
  });

  it("omits invalid numeric diagnostics for hubs and nodes", () => {
    const hass = onlineHass();
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_tx_queue_len_test_hub`,
      "not-a-number",
      HUB_DEVICE_ID
    );
    addEntity(
      hass,
      `${NODE_PREFIX}request_failures${NODE_SUFFIX}`,
      "not-a-number",
      NODE_DEVICE_ID
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.severity).toBe("healthy");
  });

  it("keeps hub metric fallback inside the selected registry device", () => {
    const hass = onlineHass();
    removeEntity(hass, HUB_STATUS_ENTITY);
    const foreignDeviceId = "foreign-device";
    hass.devices[foreignDeviceId] = device(foreignDeviceId, {
      name: "Foreign duplicate",
    });
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_node_status_foreign_duplicate`,
      "online",
      foreignDeviceId
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.hub.state).toBe("unknown");
    expect(snapshot.hub.entityId).toBeNull();
    expect(snapshot.dependentChecksSuppressed).toBe(true);
  });

  it("orders and counts actionable leaves across problem categories", () => {
    const hass = onlineHass();
    hass.states[NODE_ONLINE_ENTITY]!.state = "off";
    addEntity(
      hass,
      `binary_sensor.meshcore_${HUB_PUBKEY}_mqtt_broker_0_connection_test_hub`,
      "off",
      HUB_DEVICE_ID
    );
    addEntity(
      hass,
      `sensor.meshcore_${HUB_PUBKEY}_battery_percentage_test_hub`,
      10,
      HUB_DEVICE_ID,
      { unit_of_measurement: "%" }
    );
    addEntity(
      hass,
      `binary_sensor.meshcore_${HUB_PUBKEY}_err_pool_full_test_hub`,
      "on",
      HUB_DEVICE_ID
    );
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.issueCount).toBe(4);
    expect(snapshot.findings.map((finding) => finding.kind)).toEqual([
      "node_offline",
      "mqtt_disconnected",
      "low_battery",
      "radio_fault",
    ]);
    expect(snapshot.groups.map((group) => group.items.length)).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("uses the selected hub's registry device boundary", () => {
    const hass = onlineHass();
    const foreignHubId = "foreign-hub";
    const foreignPubkey = "abc123";
    const foreignCount = `sensor.meshcore_${foreignPubkey}_node_count_foreign`;
    const foreignStatus = `sensor.meshcore_${foreignPubkey}_node_status_foreign`;
    hass.devices[foreignHubId] = device(foreignHubId, { name: "Foreign" });
    addEntity(hass, foreignCount, 2, foreignHubId);
    addEntity(hass, foreignStatus, "online", foreignHubId);
    addEntity(
      hass,
      `binary_sensor.meshcore_${foreignPubkey}_mqtt_broker_0_connection_foreign`,
      "off",
      foreignHubId
    );
    const local = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    const foreign = buildStatusSnapshot(hass, foreignPubkey)!;
    expect(local.mqtt.total).toBe(0);
    expect(local.issueCount).toBe(0);
    expect(foreign.mqtt.disconnected).toBe(1);
  });

  it("treats a hub with no managed children as healthy information", () => {
    const hass = onlineHass();
    for (const [entityId, entry] of Object.entries(hass.entities)) {
      if (entry.device_id === NODE_DEVICE_ID) removeEntity(hass, entityId);
    }
    delete hass.devices[NODE_DEVICE_ID];
    const snapshot = buildStatusSnapshot(hass, HUB_PUBKEY)!;
    expect(snapshot.severity).toBe("healthy");
    expect(snapshot.monitoredCount).toBe(0);
  });
});

describe("renamed node devices", () => {
  // Regression for the original report: Home Assistant never rewrites existing
  // entity IDs when a device is renamed, so the connectivity sensor created
  // after the rename carried a slug no other entity shared. The single
  // majority suffix could not strip it, the lookup returned null, and the node
  // card (which had an uptime fallback) said Online while the status card
  // (which had none) said Unknown for the very same node.
  function renamedHass(): HomeAssistant {
    const hass = createHass();
    const onlineId = "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm_2";
    addEntity(hass, onlineId, "on", NODE_DEVICE_ID, {
      last_successful_request: 1_700_000_000,
    });
    hass.devices[NODE_DEVICE_ID]!.name_by_user = "Spring Farm 2";
    return hass;
  }

  it("resolves connectivity from the post-rename entity", () => {
    const node = buildStatusSnapshot(renamedHass(), HUB_PUBKEY)!.nodes.items[0]!;
    expect(node.state).toBe("online");
    expect(node.entityId).toBe(
      "binary_sensor.meshcore_a1b2c3d4e5_online_spring_farm_2"
    );
  });

  it("counts the node as online rather than as an unknown check", () => {
    const snapshot = buildStatusSnapshot(renamedHass(), HUB_PUBKEY)!;
    expect(snapshot.onlineCount).toBe(1);
    expect(snapshot.nodeUnknownCount).toBe(0);
    expect(snapshot.unknownChecks).toEqual([]);
  });

  it("still reads the pre-rename battery entity", () => {
    const node = buildStatusSnapshot(renamedHass(), HUB_PUBKEY)!.nodes.items[0]!;
    expect(node.batteryEntityId).toBe(
      `${NODE_PREFIX}battery_percentage${NODE_SUFFIX}`
    );
    expect(node.batteryPercent).toBe(90.33);
  });
});
