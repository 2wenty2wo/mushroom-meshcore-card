/** A finite numeric signal reading at a JavaScript epoch timestamp. */
export interface SignalTrendPoint {
  timestamp: number;
  value: number;
}

export const SIGNAL_TREND_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SIGNAL_TREND_MAX_STORED_POINTS = 512;
export const SIGNAL_TREND_MAX_RENDER_POINTS = 62;

const SVG_WIDTH = 100;
const SVG_TOP = 8;
const SVG_BOTTOM = 48;
const SVG_MIDDLE = (SVG_TOP + SVG_BOTTOM) / 2;
const DECIMAL_STATE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function finiteState(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || !DECIMAL_STATE.test(normalized)) return undefined;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function validPoint(value: unknown): value is SignalTrendPoint {
  if (!isRecord(value)) return false;
  return isSafeTimestamp(value.timestamp)
    && typeof value.value === "number"
    && Number.isFinite(value.value);
}

/**
 * Parse Home Assistant's compressed `history/history_during_period` response.
 * Only explicitly requested entity IDs and entries containing both `s` and
 * numeric epoch-seconds `lu` fields are accepted.
 */
export function parseSignalTrendHistory(
  response: unknown,
  entityIds: readonly string[]
): Map<string, SignalTrendPoint[]> {
  const parsed = new Map<string, SignalTrendPoint[]>();
  const envelope = isRecord(response) ? response : undefined;

  for (const entityId of entityIds) {
    if (typeof entityId !== "string" || parsed.has(entityId)) continue;
    const points: SignalTrendPoint[] = [];
    const entries = envelope
      && Object.prototype.hasOwnProperty.call(envelope, entityId)
      && Array.isArray(envelope[entityId])
      ? envelope[entityId]
      : [];

    for (const entry of entries) {
      if (!isRecord(entry)
        || !Object.prototype.hasOwnProperty.call(entry, "s")
        || !Object.prototype.hasOwnProperty.call(entry, "lu")
        || typeof entry.lu !== "number"
        || !Number.isFinite(entry.lu)) {
        continue;
      }
      const value = finiteState(entry.s);
      const timestamp = entry.lu * 1000;
      if (value === undefined || !isSafeTimestamp(timestamp)) continue;
      points.push({ timestamp, value });
    }

    parsed.set(entityId, mergeSignalTrendPoints(points, []));
  }

  return parsed;
}

/** Sort and deduplicate history followed by live data; live values win ties. */
export function mergeSignalTrendPoints(
  history: readonly SignalTrendPoint[],
  live: SignalTrendPoint | readonly SignalTrendPoint[]
): SignalTrendPoint[] {
  const byTimestamp = new Map<number, SignalTrendPoint>();
  const add = (point: unknown): void => {
    if (!validPoint(point)) return;
    byTimestamp.set(point.timestamp, {
      timestamp: point.timestamp,
      value: point.value,
    });
  };

  if (Array.isArray(history)) {
    for (const point of history) add(point);
  }
  if (Array.isArray(live)) {
    for (const point of live) add(point);
  } else {
    add(live);
  }

  return [...byTimestamp.values()].sort((left, right) =>
    left.timestamp - right.timestamp
  );
}

/**
 * Keep the fixed recent window and carry the most recent older value forward
 * to its cutoff. Future-dated samples are discarded.
 */
export function pruneSignalTrendPoints(
  points: readonly SignalTrendPoint[],
  nowMs: number,
  windowMs = SIGNAL_TREND_WINDOW_MS
): SignalTrendPoint[] {
  if (!isSafeTimestamp(nowMs)
    || !Number.isFinite(windowMs)
    || windowMs <= 0
    || windowMs > Number.MAX_SAFE_INTEGER) {
    return [];
  }
  const cutoff = nowMs - windowMs;
  if (!isSafeTimestamp(cutoff)) return [];

  const normalized = mergeSignalTrendPoints(points, []);
  let predecessor: SignalTrendPoint | undefined;
  const retained: SignalTrendPoint[] = [];
  for (const point of normalized) {
    if (point.timestamp < cutoff) predecessor = point;
    else if (point.timestamp <= nowMs) retained.push(point);
  }

  if (predecessor && (retained.length === 0 || retained[0].timestamp > cutoff)) {
    retained.unshift({ timestamp: cutoff, value: predecessor.value });
  }
  return retained;
}

function strongestExtreme(points: readonly SignalTrendPoint[]): SignalTrendPoint | undefined {
  if (points.length === 0) return undefined;
  let minimum = points[0].value;
  let maximum = points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    minimum = Math.min(minimum, points[index].value);
    maximum = Math.max(maximum, points[index].value);
  }
  const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  const middle = (minimum / scale + maximum / scale) / 2;
  let selected = points[0];
  let selectedDistance = Math.abs(points[0].value / scale - middle);
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].value / scale - middle);
    if (distance > selectedDistance) {
      selected = points[index];
      selectedDistance = distance;
    }
  }
  return selected;
}

/**
 * Bound a series while preserving its endpoints and local extrema in evenly
 * sized time buckets. Vacant buckets are backfilled by the least represented
 * timestamps so sparse histories still use the available budget.
 */
function timeBucketExtrema(
  input: readonly SignalTrendPoint[],
  maxPoints: number
): SignalTrendPoint[] {
  const points = mergeSignalTrendPoints(input, []);
  if (!Number.isSafeInteger(maxPoints) || maxPoints <= 0) return [];
  if (points.length <= maxPoints) return points;
  if (maxPoints === 1) return [points[points.length - 1]];

  const first = points[0];
  const last = points[points.length - 1];
  if (maxPoints === 2) return [first, last];

  const interior = points.slice(1, -1);
  const interiorBudget = maxPoints - 2;
  const pairedBuckets = Math.floor(interiorBudget / 2);
  const selected = new Map<number, SignalTrendPoint>([
    [first.timestamp, first],
    [last.timestamp, last],
  ]);

  if (pairedBuckets > 0 && interior.length > 0) {
    const buckets: SignalTrendPoint[][] = Array.from(
      { length: pairedBuckets },
      () => []
    );
    const span = last.timestamp - first.timestamp;
    for (const point of interior) {
      const fraction = span > 0 ? (point.timestamp - first.timestamp) / span : 0;
      const index = Math.min(
        pairedBuckets - 1,
        Math.max(0, Math.floor(fraction * pairedBuckets))
      );
      buckets[index].push(point);
    }

    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      let minimum = bucket[0];
      let maximum = bucket[0];
      for (let index = 1; index < bucket.length; index += 1) {
        const point = bucket[index];
        if (point.value < minimum.value) minimum = point;
        if (point.value > maximum.value) maximum = point;
      }
      selected.set(minimum.timestamp, minimum);
      selected.set(maximum.timestamp, maximum);
    }
  }

  if (interiorBudget % 2 === 1) {
    const remaining = interior.filter((point) => !selected.has(point.timestamp));
    const extreme = strongestExtreme(remaining);
    if (extreme) selected.set(extreme.timestamp, extreme);
  }

  // Empty time buckets or constant buckets can leave spare capacity. Fill the
  // widest temporal gaps one point at a time without sacrificing extrema.
  while (selected.size < maxPoints) {
    const orderedSelected = [...selected.values()].sort((left, right) =>
      left.timestamp - right.timestamp
    );
    let candidate: SignalTrendPoint | undefined;
    let candidateDistance = -1;
    for (const point of interior) {
      if (selected.has(point.timestamp)) continue;
      let distance = Number.POSITIVE_INFINITY;
      for (const existing of orderedSelected) {
        distance = Math.min(distance, Math.abs(point.timestamp - existing.timestamp));
      }
      if (distance > candidateDistance) {
        candidate = point;
        candidateDistance = distance;
      }
    }
    if (!candidate) break;
    selected.set(candidate.timestamp, candidate);
  }

  return [...selected.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, maxPoints);
}

export function limitStoredSignalTrendPoints(
  points: readonly SignalTrendPoint[],
  maxPoints = SIGNAL_TREND_MAX_STORED_POINTS
): SignalTrendPoint[] {
  return timeBucketExtrema(points, maxPoints);
}

export function downsampleSignalTrendPoints(
  points: readonly SignalTrendPoint[],
  maxPoints = SIGNAL_TREND_MAX_RENDER_POINTS
): SignalTrendPoint[] {
  return timeBucketExtrema(points, maxPoints);
}

/** Extend a series to its current endpoint, optionally overriding its value. */
export function withSignalTrendEndpoint(
  points: readonly SignalTrendPoint[],
  endMs: number,
  currentValue?: number
): SignalTrendPoint[] {
  if (!isSafeTimestamp(endMs)) return mergeSignalTrendPoints(points, []);
  const retained = mergeSignalTrendPoints(points, [])
    .filter((point) => point.timestamp <= endMs);
  const value = currentValue === undefined
    ? retained[retained.length - 1]?.value
    : currentValue;
  if (typeof value !== "number" || !Number.isFinite(value)) return retained;
  return mergeSignalTrendPoints(retained, { timestamp: endMs, value });
}

function svgCoordinate(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Build an inert SVG `polyline` points attribute for a fixed time window.
 * This returns coordinates only; callers own the trusted SVG element shape.
 */
export function buildSignalTrendSvgPoints(
  input: readonly SignalTrendPoint[],
  startMs: number,
  endMs: number,
  maxPoints = SIGNAL_TREND_MAX_RENDER_POINTS
): string | undefined {
  if (!isSafeTimestamp(startMs)
    || !isSafeTimestamp(endMs)
    || endMs <= startMs
    || !Number.isSafeInteger(maxPoints)
    || maxPoints < 2) {
    return undefined;
  }

  const normalized = mergeSignalTrendPoints(input, []);
  let predecessor: SignalTrendPoint | undefined;
  const visible: SignalTrendPoint[] = [];
  for (const point of normalized) {
    if (point.timestamp < startMs) predecessor = point;
    else if (point.timestamp <= endMs) visible.push(point);
  }
  if (predecessor && (visible.length === 0 || visible[0].timestamp > startMs)) {
    visible.unshift({ timestamp: startMs, value: predecessor.value });
  }
  if (visible.length < 2) return undefined;

  let minimum = visible[0].value;
  let maximum = visible[0].value;
  for (let index = 1; index < visible.length; index += 1) {
    minimum = Math.min(minimum, visible[index].value);
    maximum = Math.max(maximum, visible[index].value);
  }
  const constant = minimum === maximum;
  const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  const scaledMinimum = minimum / scale;
  const scaledRange = maximum / scale - scaledMinimum;
  if (!constant && (!Number.isFinite(scaledRange) || scaledRange <= 0)) {
    return undefined;
  }

  const rendered = downsampleSignalTrendPoints(visible, maxPoints);
  const duration = endMs - startMs;
  const coordinates: string[] = [];
  for (const point of rendered) {
    const x = Math.min(
      SVG_WIDTH,
      Math.max(0, ((point.timestamp - startMs) / duration) * SVG_WIDTH)
    );
    const ratio = constant
      ? 0.5
      : (point.value / scale - scaledMinimum) / scaledRange;
    const y = constant
      ? SVG_MIDDLE
      : SVG_BOTTOM - Math.min(1, Math.max(0, ratio)) * (SVG_BOTTOM - SVG_TOP);
    const safeX = svgCoordinate(x);
    const safeY = svgCoordinate(y);
    if (safeX === undefined || safeY === undefined) return undefined;
    coordinates.push(`${safeX},${safeY}`);
  }

  return coordinates.length >= 2 ? coordinates.join(" ") : undefined;
}
