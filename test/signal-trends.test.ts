import { describe, expect, it } from "vitest";
import {
  SIGNAL_TREND_MAX_RENDER_POINTS,
  SIGNAL_TREND_MAX_STORED_POINTS,
  SIGNAL_TREND_WINDOW_MS,
  buildSignalTrendSvgPoints,
  downsampleSignalTrendPoints,
  limitStoredSignalTrendPoints,
  mergeSignalTrendPoints,
  parseSignalTrendHistory,
  pruneSignalTrendPoints,
  withSignalTrendEndpoint,
  type SignalTrendPoint,
} from "../src/signal-trends.js";

const NOW = 1_800_000_000_000;

describe("signal trends", () => {
  it("parses requested compressed history into sorted millisecond points", () => {
    const result = parseSignalTrendHistory({
      "sensor.rssi": [
        { s: "-79.5", lu: 1_800_000_002 },
        { s: "-81", lu: 1_800_000_000 },
        { s: "-80", lu: 1_800_000_002 },
      ],
      "sensor.snr": [{ s: 4.25, lu: 1_800_000_001.25 }],
      "sensor.not_requested": [{ s: "99", lu: 1_800_000_000 }],
    }, ["sensor.rssi", "sensor.snr", "sensor.missing", "sensor.rssi"]);

    expect([...result.keys()]).toEqual([
      "sensor.rssi",
      "sensor.snr",
      "sensor.missing",
    ]);
    expect(result.get("sensor.rssi")).toEqual([
      { timestamp: 1_800_000_000_000, value: -81 },
      { timestamp: 1_800_000_002_000, value: -80 },
    ]);
    expect(result.get("sensor.snr")).toEqual([
      { timestamp: 1_800_000_001_250, value: 4.25 },
    ]);
    expect(result.get("sensor.missing")).toEqual([]);
    expect(result.has("sensor.not_requested")).toBe(false);
  });

  it("rejects malformed states, timestamps, envelopes, and overflow", () => {
    const invalidEntries = [
      { s: "", lu: 1 },
      { s: "unavailable", lu: 2 },
      { s: "1 dB", lu: 3 },
      { s: "0x10", lu: 4 },
      { s: "1e309", lu: 5 },
      { s: Number.NaN, lu: 6 },
      { s: Number.POSITIVE_INFINITY, lu: 7 },
      { s: "1", lu: "8" },
      { s: "1", lu: Number.NaN },
      { s: "1", lu: Number.MAX_SAFE_INTEGER },
      { s: "1" },
      { lu: 10 },
      null,
    ];
    expect(parseSignalTrendHistory(
      { "sensor.rssi": invalidEntries },
      ["sensor.rssi"]
    ).get("sensor.rssi")).toEqual([]);
    expect(parseSignalTrendHistory([], ["sensor.rssi"]).get("sensor.rssi"))
      .toEqual([]);
  });

  it("merges in order with live points winning timestamp collisions", () => {
    const result = mergeSignalTrendPoints([
      { timestamp: 30, value: 3 },
      { timestamp: 10, value: 1 },
      { timestamp: 20, value: 2 },
      { timestamp: Number.NaN, value: 9 },
    ], [
      { timestamp: 20, value: 22 },
      { timestamp: 40, value: 4 },
      { timestamp: 50, value: Number.POSITIVE_INFINITY },
    ]);
    expect(result).toEqual([
      { timestamp: 10, value: 1 },
      { timestamp: 20, value: 22 },
      { timestamp: 30, value: 3 },
      { timestamp: 40, value: 4 },
    ]);
  });

  it("prunes to six hours, carries the predecessor to the cutoff, and drops future data", () => {
    const cutoff = NOW - SIGNAL_TREND_WINDOW_MS;
    expect(pruneSignalTrendPoints([
      { timestamp: cutoff - 2_000, value: -90 },
      { timestamp: cutoff - 1_000, value: -89 },
      { timestamp: cutoff + 1_000, value: -80 },
      { timestamp: NOW, value: -70 },
      { timestamp: NOW + 1, value: -60 },
    ], NOW)).toEqual([
      { timestamp: cutoff, value: -89 },
      { timestamp: cutoff + 1_000, value: -80 },
      { timestamp: NOW, value: -70 },
    ]);

    expect(pruneSignalTrendPoints([
      { timestamp: cutoff - 1, value: 1 },
      { timestamp: cutoff, value: 2 },
    ], NOW)).toEqual([{ timestamp: cutoff, value: 2 }]);
    expect(pruneSignalTrendPoints([], Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("caps storage with time-bucket extrema and stable endpoints", () => {
    const points: SignalTrendPoint[] = Array.from({ length: 2_000 }, (_, index) => ({
      timestamp: index * 1_000,
      value: index === 777 ? -10_000 : index === 1_333 ? 10_000 : index % 17,
    }));
    const limited = limitStoredSignalTrendPoints(points);
    expect(limited).toHaveLength(SIGNAL_TREND_MAX_STORED_POINTS);
    expect(limited[0]).toEqual(points[0]);
    expect(limited[limited.length - 1]).toEqual(points[points.length - 1]);
    expect(limited.some(({ value }) => value === -10_000)).toBe(true);
    expect(limited.some(({ value }) => value === 10_000)).toBe(true);
    expect(limited.every((point, index) =>
      index === 0 || point.timestamp > limited[index - 1].timestamp
    )).toBe(true);
  });

  it("uses the same extrema strategy for the smaller render budget", () => {
    const points = Array.from({ length: 500 }, (_, index) => ({
      timestamp: index,
      value: index === 123 ? -500 : index === 321 ? 500 : Math.sin(index),
    }));
    const rendered = downsampleSignalTrendPoints(points);
    expect(rendered).toHaveLength(SIGNAL_TREND_MAX_RENDER_POINTS);
    expect(rendered[0]).toEqual(points[0]);
    expect(rendered[rendered.length - 1]).toEqual(points[points.length - 1]);
    expect(rendered.some(({ value }) => value === -500)).toBe(true);
    expect(rendered.some(({ value }) => value === 500)).toBe(true);
    expect(downsampleSignalTrendPoints(points, 1)).toEqual([
      points[points.length - 1],
    ]);
    expect(downsampleSignalTrendPoints(points, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("extends a series to a current endpoint and safely overrides a collision", () => {
    expect(withSignalTrendEndpoint([
      { timestamp: 10, value: -80 },
      { timestamp: 20, value: -70 },
      { timestamp: 40, value: -50 },
    ], 30)).toEqual([
      { timestamp: 10, value: -80 },
      { timestamp: 20, value: -70 },
      { timestamp: 30, value: -70 },
    ]);
    expect(withSignalTrendEndpoint([
      { timestamp: 10, value: -80 },
      { timestamp: 20, value: -70 },
    ], 20, -60)).toEqual([
      { timestamp: 10, value: -80 },
      { timestamp: 20, value: -60 },
    ]);
    expect(withSignalTrendEndpoint([], 20)).toEqual([]);
  });

  it("maps a fixed time window into safe SVG coordinates", () => {
    expect(buildSignalTrendSvgPoints([
      { timestamp: 0, value: -100 },
      { timestamp: 50, value: -50 },
      { timestamp: 100, value: -75 },
    ], 0, 100)).toBe("0,48 50,8 100,28");

    expect(buildSignalTrendSvgPoints([
      { timestamp: -10, value: 4 },
      { timestamp: 50, value: 4 },
      { timestamp: 100, value: 4 },
    ], 0, 100)).toBe("0,28 50,28 100,28");
  });

  it("never emits non-finite or out-of-band SVG coordinates", () => {
    const output = buildSignalTrendSvgPoints([
      { timestamp: 0, value: -Number.MAX_VALUE },
      { timestamp: 50, value: 0 },
      { timestamp: 100, value: Number.MAX_VALUE },
      { timestamp: 75, value: Number.POSITIVE_INFINITY },
    ], 0, 100);
    expect(output).toBeDefined();
    expect(output).not.toMatch(/NaN|Infinity/);
    for (const coordinate of output!.split(" ")) {
      const [x, y] = coordinate.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(8);
      expect(y).toBeLessThanOrEqual(48);
    }

    expect(buildSignalTrendSvgPoints([{ timestamp: 0, value: 1 }], 0, 100))
      .toBeUndefined();
    expect(buildSignalTrendSvgPoints([
      { timestamp: 0, value: 1 },
      { timestamp: 1, value: 2 },
    ], 1, 1)).toBeUndefined();
  });
});
