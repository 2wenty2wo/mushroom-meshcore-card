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

// Candidate autolink matches. An explicit http(s) scheme is required: text
// like `www.example.com` is left alone, because inventing a scheme for
// schemeless input is exactly how an attacker gets to pick one. The class is
// a single unbounded repetition with no nesting, so matching stays linear.
const URL_CANDIDATE_RE = /https?:\/\/[^\s<>"']+/gi;

// Drop sentence punctuation that trails a pasted link rather than belonging
// to it, so "see https://example.com/x." links `…/x` and leaves the period as
// text. A closing bracket is only trimmed when the match has no matching
// opener, which keeps URLs like `…/wiki/Foo_(bar)` intact.
function trimTrailingPunctuation(match: string): string {
  let end = match.length;
  while (end > 0) {
    const ch = match[end - 1];
    if (".,;:!?".includes(ch)) {
      end--;
      continue;
    }
    const open = ch === ")" ? "(" : ch === "]" ? "[" : ch === "}" ? "{" : null;
    if (open) {
      const slice = match.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(ch).length - 1;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return match.slice(0, end);
}

function safeHttpUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** One stretch of text that autolinking treats as a URL. `start` is inclusive
 *  and `end` exclusive, `text` is exactly what was written, and `href` is the
 *  parsed and normalized address. */
export interface UrlSpan {
  start: number;
  end: number;
  text: string;
  href: string;
}

/** Locate every http(s) URL in `text`, in order and without overlaps. This is
 *  the single definition of "a URL" shared by autolinking and by the channel
 *  card's sender/body split, so the two cannot disagree about where a URL
 *  begins and ends — a message like `https://example.com:8443/map` must not
 *  have its port colon mistaken for a sender separator. Candidates the URL
 *  parser rejects are not spans, so they stay ordinary text. */
export function urlSpans(text: string): UrlSpan[] {
  const spans: UrlSpan[] = [];
  URL_CANDIDATE_RE.lastIndex = 0;
  for (
    let match = URL_CANDIDATE_RE.exec(text);
    match;
    match = URL_CANDIDATE_RE.exec(text)
  ) {
    const candidate = trimTrailingPunctuation(match[0]);
    const href = safeHttpUrl(candidate);
    // A rejected candidate is simply not a span; the scanner has already
    // advanced past the raw match, so it resumes after it.
    if (!href) continue;
    const start = match.index;
    const end = start + candidate.length;
    spans.push({ start, end, text: candidate, href });
    URL_CANDIDATE_RE.lastIndex = end;
  }
  return spans;
}

/** Autolink http(s) URLs inside attacker-authored message text. Returns HTML
 *  that is already escaped, so it is a drop-in replacement for `escapeHtml`
 *  at a call site — never mix the two on the same string.
 *
 *  The ordering is the security property. Every stretch between spans goes
 *  through `escapeHtml`, and a span exists only once the URL parser has
 *  confirmed an http(s) scheme. The `href` is rebuilt from the parsed
 *  `URL.href` rather than the raw substring and escaped on top, so a scheme
 *  this function did not explicitly allow can never reach the attribute.
 *  Anything that fails to parse stays plain escaped text. */
export function linkifyHtml(text: unknown): string {
  const source = text === null || text === undefined ? "" : String(text);
  let out = "";
  let last = 0;
  for (const span of urlSpans(source)) {
    out += escapeHtml(source.slice(last, span.start));
    out += `<a class="message-link" href="${escapeHtml(
      span.href
    )}" target="_blank" rel="noopener noreferrer">${escapeHtml(span.text)}</a>`;
    last = span.end;
  }
  return out + escapeHtml(source.slice(last));
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

/** Approximate Home Assistant's `slugify` for a device/entity display name.
 *  NFD decomposition splits an accented letter into an ASCII base plus a
 *  combining mark, so dropping every non-ASCII code point transliterates
 *  rather than mangles: "Café" becomes `cafe`, not `caf_`. Used to predict
 *  the entity-ID slug a device carries. */
export function slugifyName(value: unknown): string {
  const ascii = [...String(value ?? "").normalize("NFD")]
    .filter((ch) => ch.codePointAt(0)! < 128)
    .join("");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

/** Human wording for MeshCore's `out_path_len`.
 *
 *  `-1` means no established route, so traffic floods the mesh; `0` means the
 *  hub reaches the node directly; anything above that is a hop count. The value
 *  arrives as a native number when read from a contact entity's attributes and
 *  as a string when read from a sensor state, so both are accepted.
 *
 *  Returns null rather than a placeholder for anything unusable, because the
 *  chip renderers hide a null value — an unreadable path should leave no trace
 *  instead of claiming the node is direct. */
export function formatPathLength(
  hops: string | number | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  if (hops === null || hops === undefined) return null;
  const normalized = String(hops).trim().toLowerCase();
  if (
    !normalized ||
    ["unknown", "unavailable", "none", "null"].includes(normalized)
  ) {
    return null;
  }
  const v = Number(normalized);
  // `-1` is the only meaningful negative, and a fractional hop count is data we
  // do not understand rather than a value worth rounding.
  if (!Number.isInteger(v) || v < -1) return null;
  if (v === -1) return t("card.path_flood");
  if (v === 0) return t("card.path_direct");
  return t(v === 1 ? "card.path_hop_one" : "card.path_hops_count", { n: v });
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
