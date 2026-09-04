import type { LocalizeFunc } from "./localize.js";
import type { StatusSnapshot, StatusUnknownKind } from "./status-model.js";

/** Unknown checks that describe a node we could not reach, as opposed to a
 *  reading we could not take. Only these belong beside the online count. */
const NODE_UNKNOWN_KINDS: readonly StatusUnknownKind[] = ["node_status"];

export interface StatusSummaryParts {
  /** Findings that need attention, or null when there are none. */
  issues: string | null;
  /** `n/total online`, or null when the hub manages no nodes. */
  online: string | null;
  /** Nodes whose reachability could not be established. */
  unknownNodes: string | null;
  /** Telemetry we could not read on an otherwise reachable subject. */
  unknownReadings: string | null;
  /** Nothing is wrong and nothing went unverified. */
  calm: boolean;
}

function plural(
  t: LocalizeFunc,
  count: number,
  oneKey: string,
  manyKey: string
): string | null {
  if (count <= 0) return null;
  return count === 1 ? t(oneKey) : t(manyKey, { n: count });
}

/** Break a snapshot into the phrases both Status surfaces are built from.
 *
 *  Node counts and check counts are deliberately kept apart. Reporting
 *  "2 unknown · 10/11 online" invited the reader to add the two together, when
 *  one counted checks (a node plus a battery) and the other counted nodes. */
export function statusSummaryParts(
  snapshot: StatusSnapshot,
  t: LocalizeFunc
): StatusSummaryParts {
  const unknownNodeCount = snapshot.unknownChecks.filter((check) =>
    NODE_UNKNOWN_KINDS.includes(check.kind)
  ).length;
  // Derived from the checks rather than from `unknownCount` so a hub-level
  // unknown, which short-circuits the summary anyway, can never leak in here.
  const unknownReadingCount = snapshot.unknownChecks.length - unknownNodeCount;

  return {
    issues: plural(
      t,
      snapshot.issueCount,
      "card.status_issue_one",
      "card.status_issue_count"
    ),
    online:
      snapshot.monitoredCount > 0
        ? t("card.status_online_count", {
            online: snapshot.onlineCount,
            total: snapshot.monitoredCount,
          })
        : null,
    unknownNodes: plural(
      t,
      unknownNodeCount,
      "card.status_unknown_nodes_one",
      "card.status_unknown_nodes_count"
    ),
    unknownReadings: plural(
      t,
      unknownReadingCount,
      "card.status_unknown_readings_one",
      "card.status_unknown_readings_count"
    ),
    calm: snapshot.issueCount === 0 && snapshot.unknownChecks.length === 0,
  };
}

function join(parts: readonly (string | null)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** The card has room to lead with a verdict and still carry every count. */
export function statusCardSummary(
  snapshot: StatusSnapshot,
  t: LocalizeFunc
): string {
  if (snapshot.hub.state === "offline") {
    return join([
      t("card.status_hub_offline"),
      t("card.status_downstream_paused"),
    ]);
  }
  if (snapshot.hub.state === "unknown") return t("card.status_unknown");

  const parts = statusSummaryParts(snapshot, t);
  if (parts.calm) {
    return join([
      t("card.status_healthy"),
      parts.online ?? t("card.status_no_monitored_nodes"),
    ]);
  }
  return join([
    parts.issues,
    parts.online,
    parts.unknownNodes,
    parts.unknownReadings,
  ]);
}

/** The badge is a single ellipsised line, so it leads with the most urgent
 *  count rather than repeating the full breakdown. */
export function statusBadgeSummary(
  snapshot: StatusSnapshot,
  t: LocalizeFunc
): string {
  if (snapshot.hub.state === "offline") return t("card.status_hub_offline");
  if (snapshot.hub.state === "unknown") return t("card.status_unknown");

  const parts = statusSummaryParts(snapshot, t);
  return join([
    parts.issues ?? parts.online ?? t("card.status_hub_online"),
    parts.unknownNodes,
    parts.unknownReadings,
  ]);
}
