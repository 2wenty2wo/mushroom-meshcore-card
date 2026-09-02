// Escape any string that originates from outside the card (HA entity state,
// HA attributes, mesh radio adv_name, raw event payloads, etc.) before it is
// interpolated into an innerHTML template literal. Without this, a hostile
// node operator can inject arbitrary HTML/JS via fields like adv_name —
// the meshcore firmware does not validate or sanitize these strings, and
// neither the meshcore_py SDK nor the HA integration escape them.
export function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function longestCommonPrefix(strs: string[]): string {
  if (!strs.length) return "";
  let i = 0;
  while (i < strs[0].length && strs.every((s) => s[i] === strs[0][i])) i++;
  return strs[0].slice(0, i);
}

export function longestCommonSuffix(strs: string[]): string {
  const rev = strs.map((s) => [...s].reverse().join(""));
  return [...longestCommonPrefix(rev)].reverse().join("");
}

export function isOnlineState(v: unknown): boolean {
  // "on" covers binary_sensor connectivity entities (e.g. *_online_*),
  // which the meshcore-ha integration uses for repeater status.
  return ["online", "connected", "on", "1", "true"].includes(
    String(v).toLowerCase()
  );
}

export function formatLastSeen(
  ts: string | number | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  if (!ts || ts === "unknown" || ts === "unavailable") return null;
  const numeric = Number(ts);
  const seconds = Number.isFinite(numeric)
    ? numeric > 1_000_000_000_000
      ? numeric / 1000
      : numeric
    : Date.parse(String(ts)) / 1000;
  const diff = Math.floor(Date.now() / 1000 - seconds);
  if (isNaN(diff) || diff < 0) return null;
  if (diff < 60) return t("time.s_ago", { n: diff });
  if (diff < 3600) return t("time.m_ago", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.h_ago", { n: Math.floor(diff / 3600) });
  return t("time.d_ago", { n: Math.floor(diff / 86400) });
}

export function batteryColor(pct: string | number | null): string {
  const v = Number(pct);
  if (isNaN(v)) return "var(--mushroom-meshcore-muted-color, var(--secondary-text-color))";
  if (v >= 50) return "var(--mushroom-meshcore-success-color, var(--success-color, #4caf50))";
  if (v >= 20) return "var(--mushroom-meshcore-warning-color, var(--warning-color, #ff9800))";
  return "var(--mushroom-meshcore-danger-color, var(--error-color, #f44336))";
}

export type ColorClass = "green" | "yellow" | "red" | "dim";

export function batteryClass(pct: string | number | null): ColorClass {
  const v = Number(pct);
  if (isNaN(v)) return "dim";
  if (v >= 50) return "green";
  if (v >= 20) return "yellow";
  return "red";
}

export function formatUptime(
  days: string | number | null | undefined
): string | null {
  const v = parseFloat(String(days));
  if (isNaN(v) || v < 0) return null;
  const d = Math.floor(v);
  const h = Math.floor((v - d) * 24);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

export function rssiClass(rssi: string | number | null): ColorClass {
  const v = Number(rssi);
  if (isNaN(v)) return "dim";
  if (v >= -70) return "green";
  if (v >= -90) return "yellow";
  return "red";
}

// Named colors accepted by icon_color, matching HA's ui_color selector and
// Mushroom's icon_color option. They resolve through HA's global `--<name>-color`
// theme properties; anything else passes through as a raw CSS color.
const NAMED_COLORS = new Set([
  "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue",
  "cyan", "teal", "green", "light-green", "lime", "yellow", "amber", "orange",
  "deep-orange", "brown", "light-grey", "grey", "dark-grey", "blue-grey",
  "black", "white", "disabled",
]);

/** Resolve a configured color to a CSS value, or null when it is not a
 *  recognizably safe color. The result is interpolated into an inline
 *  `style` attribute, so raw passthrough is limited to strict color
 *  syntax — HTML escaping alone cannot stop CSS declaration injection
 *  via characters like `;` in an arbitrary string. */
export function computeCssColor(color: string): string | null {
  const c = color.trim();
  const lower = c.toLowerCase();
  if (lower === "primary") return "var(--primary-color)";
  if (lower === "accent") return "var(--accent-color)";
  if (NAMED_COLORS.has(lower)) return `var(--${lower}-color)`;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
  if (/^[a-z]+$/i.test(c)) return lower; // CSS named colors, e.g. rebeccapurple
  if (/^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z.,%\s/-]*\s*\)$/i.test(c)) return c;
  return null;
}

export interface MapLinkConfig {
  map_provider?: string;
  map_metro?: string;
}

/** Build the external map URL for a coordinate pair. Defaults to the
 *  LetsMesh Analyzer; `map_provider: meshmapper` + `map_metro` selects a
 *  MeshMapper regional instance. The metro becomes a subdomain, so it is
 *  validated to hostname-safe characters — anything else falls back to
 *  the Analyzer rather than emitting a broken or abusable URL. Note the
 *  differing longitude params: Analyzer uses `long=`, MeshMapper `lon=`. */
export function mapLinkUrl(cfg: MapLinkConfig, lat: unknown, lon: unknown): string {
  const latF = parseFloat(String(lat)).toFixed(5);
  const lonF = parseFloat(String(lon)).toFixed(5);
  const metro = (cfg.map_metro ?? "").trim().toLowerCase();
  if (cfg.map_provider === "meshmapper" && /^[a-z0-9-]{1,20}$/.test(metro)) {
    return `https://${metro}.meshmapper.net/?lat=${latF}&lon=${lonF}&zoom=10`;
  }
  return `https://analyzer.letsmesh.net/map?lat=${latF}&long=${lonF}&zoom=10`;
}
