import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batteryClass,
  batteryColor,
  computeCssColor,
  escapeHtml,
  formatLastSeen,
  formatUptime,
  isOnlineState,
  linkifyHtml,
  longestCommonPrefix,
  longestCommonSuffix,
  mapLinkUrl,
  rssiClass,
} from "../src/helpers.js";

describe("escapeHtml", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<b class="x">Tom & Jerry's</b>`)).toBe(
      "&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;"
    );
  });

  it("returns empty string for null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("stringifies non-string values", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("longestCommonPrefix / longestCommonSuffix", () => {
  it("handles empty and single-element inputs", () => {
    expect(longestCommonPrefix([])).toBe("");
    expect(longestCommonPrefix(["abc"])).toBe("abc");
    expect(longestCommonSuffix(["abc"])).toBe("abc");
  });

  it("finds the shared prefix and suffix", () => {
    expect(
      longestCommonPrefix(["sensor.node_rssi", "sensor.node_snr"])
    ).toBe("sensor.node_");
    expect(
      longestCommonSuffix(["sensor.a_spring_farm", "sensor.b_spring_farm"])
    ).toBe("_spring_farm");
  });

  it("collapses to empty when nothing is shared", () => {
    expect(longestCommonPrefix(["abc", "xyz"])).toBe("");
    expect(longestCommonSuffix(["abc", "xyz"])).toBe("");
  });
});

describe("isOnlineState", () => {
  it("accepts the documented online spellings, case-insensitively", () => {
    for (const value of ["online", "Online", "connected", "on", "1", "true", 1, true]) {
      expect(isOnlineState(value), String(value)).toBe(true);
    }
  });

  it("rejects offline and unknown states", () => {
    for (const value of ["offline", "off", "0", "unknown", "unavailable", "", null]) {
      expect(isOnlineState(value), String(value)).toBe(false);
    }
  });
});

describe("formatLastSeen", () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    `${key}:${vars?.["n"]}`;
  const NOW_SECONDS = 1_700_000_000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockNow = () =>
    vi.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);

  it("returns null for missing or unavailable timestamps", () => {
    expect(formatLastSeen(null, t)).toBeNull();
    expect(formatLastSeen(undefined, t)).toBeNull();
    expect(formatLastSeen("unknown", t)).toBeNull();
    expect(formatLastSeen("unavailable", t)).toBeNull();
  });

  it("returns null for non-numeric and future timestamps", () => {
    mockNow();
    expect(formatLastSeen("soon", t)).toBeNull();
    expect(formatLastSeen(NOW_SECONDS + 60, t)).toBeNull();
  });

  it("scales through seconds, minutes, hours, and days", () => {
    mockNow();
    expect(formatLastSeen(NOW_SECONDS - 30, t)).toBe("time.s_ago:30");
    expect(formatLastSeen(NOW_SECONDS - 90, t)).toBe("time.m_ago:1");
    expect(formatLastSeen(NOW_SECONDS - 2 * 3600, t)).toBe("time.h_ago:2");
    expect(formatLastSeen(NOW_SECONDS - 3 * 86400, t)).toBe("time.d_ago:3");
  });

  it("accepts numeric strings", () => {
    mockNow();
    expect(formatLastSeen(String(NOW_SECONDS - 45), t)).toBe("time.s_ago:45");
  });

  it("accepts millisecond and ISO timestamps from Home Assistant attributes", () => {
    mockNow();
    expect(formatLastSeen((NOW_SECONDS - 30) * 1000, t)).toBe("time.s_ago:30");
    expect(
      formatLastSeen(new Date((NOW_SECONDS - 90) * 1000).toISOString(), t)
    ).toBe("time.m_ago:1");
  });
});

describe("battery helpers", () => {
  it("classifies percentage bands", () => {
    expect(batteryClass(100)).toBe("green");
    expect(batteryClass(50)).toBe("green");
    expect(batteryClass(49.9)).toBe("yellow");
    expect(batteryClass(20)).toBe("yellow");
    expect(batteryClass(19)).toBe("red");
    expect(batteryClass("not-a-number")).toBe("dim");
  });

  it("maps bands onto semantic theme colors", () => {
    expect(batteryColor(80)).toContain("success-color");
    expect(batteryColor(30)).toContain("warning-color");
    expect(batteryColor(5)).toContain("danger-color");
    expect(batteryColor("n/a")).toContain("muted-color");
  });
});

describe("rssiClass", () => {
  it("classifies signal strength bands", () => {
    expect(rssiClass(-50)).toBe("green");
    expect(rssiClass(-70)).toBe("green");
    expect(rssiClass(-71)).toBe("yellow");
    expect(rssiClass(-90)).toBe("yellow");
    expect(rssiClass(-91)).toBe("red");
    expect(rssiClass("bad")).toBe("dim");
  });
});

describe("formatUptime", () => {
  it("formats fractional days as days and hours", () => {
    expect(formatUptime(1.5)).toBe("1d 12h");
    expect(formatUptime(2)).toBe("2d 0h");
  });

  it("drops the day part below one day", () => {
    expect(formatUptime(0.5)).toBe("12h");
    expect(formatUptime(0)).toBe("0h");
  });

  it("returns null for negative or non-numeric input", () => {
    expect(formatUptime(-1)).toBeNull();
    expect(formatUptime("soon")).toBeNull();
    expect(formatUptime(null)).toBeNull();
    expect(formatUptime(undefined)).toBeNull();
  });

  it("accepts numeric strings", () => {
    expect(formatUptime("1.25")).toBe("1d 6h");
  });
});

describe("computeCssColor", () => {
  it("maps primary/accent and Mushroom color names to theme variables", () => {
    expect(computeCssColor("primary")).toBe("var(--primary-color)");
    expect(computeCssColor("accent")).toBe("var(--accent-color)");
    expect(computeCssColor("red")).toBe("var(--red-color)");
    expect(computeCssColor("deep-purple")).toBe("var(--deep-purple-color)");
    expect(computeCssColor("Blue-Grey")).toBe("var(--blue-grey-color)");
  });

  it("passes through strict raw CSS color syntax", () => {
    expect(computeCssColor("#abc")).toBe("#abc");
    expect(computeCssColor("#a1b2c3")).toBe("#a1b2c3");
    expect(computeCssColor("#a1b2c3d4")).toBe("#a1b2c3d4");
    expect(computeCssColor("rebeccapurple")).toBe("rebeccapurple");
    expect(computeCssColor("RebeccaPurple")).toBe("rebeccapurple");
    expect(computeCssColor("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
    expect(computeCssColor("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
    expect(computeCssColor("hsl(120, 50%, 50%)")).toBe("hsl(120, 50%, 50%)");
    expect(computeCssColor("  teal  ")).toBe("var(--teal-color)");
  });

  it("rejects anything that could escape an inline style declaration", () => {
    expect(computeCssColor("red;background:url(evil)")).toBeNull();
    expect(computeCssColor("#12345")).toBeNull();
    expect(computeCssColor('url("x")')).toBeNull();
    expect(computeCssColor("var(--primary-color)")).toBeNull();
    expect(computeCssColor("")).toBeNull();
  });
});

describe("mapLinkUrl", () => {
  it("defaults to the LetsMesh Analyzer with long= and 5-decimal coordinates", () => {
    expect(mapLinkUrl({}, -33.86123456, 151.20987654)).toBe(
      "https://analyzer.letsmesh.net/map?lat=-33.86123&long=151.20988&zoom=10"
    );
  });

  it("uses a MeshMapper metro subdomain when configured", () => {
    expect(
      mapLinkUrl({ map_provider: "meshmapper", map_metro: "SYD" }, -33.5, 151.5)
    ).toBe("https://syd.meshmapper.net/?lat=-33.50000&lon=151.50000&zoom=10");
  });

  it("falls back to the Analyzer for unsafe or missing metros", () => {
    for (const metro of [undefined, "", "bad.metro", "a/b", "x".repeat(21)]) {
      const url = mapLinkUrl({ map_provider: "meshmapper", map_metro: metro }, 1, 2);
      expect(url, String(metro)).toContain("https://analyzer.letsmesh.net/");
    }
  });

  it("ignores the metro for the default provider", () => {
    expect(mapLinkUrl({ map_metro: "syd" }, 1, 2)).toContain(
      "https://analyzer.letsmesh.net/"
    );
  });
});

// linkifyHtml replaces escapeHtml at message-body call sites, so it carries the
// same guarantee: whatever it returns is safe to assign through innerHTML. The
// text it processes is chosen by whoever operates a radio in range, so these
// cases are adversarial by default.
describe("linkifyHtml", () => {
  const ANCHOR_RE =
    /^<a class="message-link" href="([^"]*)" target="_blank" rel="noopener noreferrer">(.*)<\/a>$/;

  it("matches escapeHtml exactly when there is no URL", () => {
    for (const text of [
      "",
      "hello mesh",
      `<img src=x onerror="alert(1)">`,
      "Tom & Jerry's <b>node</b>",
      "ping me at bob@example.com",
    ]) {
      expect(linkifyHtml(text), text).toBe(escapeHtml(text));
    }
  });

  it("links a bare http(s) URL", () => {
    const match = ANCHOR_RE.exec(linkifyHtml("https://example.com/path"));
    expect(match).not.toBeNull();
    expect(match![1]).toBe("https://example.com/path");
    expect(match![2]).toBe("https://example.com/path");
    expect(linkifyHtml("http://example.com/")).toContain(
      'href="http://example.com/"'
    );
  });

  it("keeps surrounding text escaped", () => {
    expect(linkifyHtml(`<b>see</b> https://example.com/ & stop`)).toBe(
      '&lt;b&gt;see&lt;/b&gt; <a class="message-link" href="https://example.com/"' +
        ' target="_blank" rel="noopener noreferrer">https://example.com/</a>' +
        " &amp; stop"
    );
  });

  it("links every URL in a message", () => {
    const html = linkifyHtml("a https://one.example/ b https://two.example/ c");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="https://one.example/"');
    expect(html).toContain('href="https://two.example/"');
  });

  it("leaves trailing sentence punctuation outside the link", () => {
    expect(linkifyHtml("see https://example.com/x.")).toBe(
      'see <a class="message-link" href="https://example.com/x" target="_blank"' +
        ' rel="noopener noreferrer">https://example.com/x</a>.'
    );
    expect(linkifyHtml("(https://example.com/x)")).toContain(
      ">https://example.com/x</a>)"
    );
  });

  it("keeps balanced parentheses inside the link", () => {
    expect(linkifyHtml("https://example.com/wiki/Foo_(bar)")).toContain(
      'href="https://example.com/wiki/Foo_(bar)"'
    );
  });

  it("never links a non-http(s) scheme", () => {
    for (const text of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "www.example.com",
      "http://",
    ]) {
      expect(linkifyHtml(text), text).not.toContain("<a ");
      expect(linkifyHtml(text), text).toBe(escapeHtml(text));
    }
  });

  it("leaves text the URL parser rejects as plain text", () => {
    // These start with a real scheme, so the scan matches them, but the URL
    // parser refuses them — an unparseable candidate must never become a link.
    for (const text of ["http://[", "https://[::1", "http://%"]) {
      expect(linkifyHtml(text), text).toBe(escapeHtml(text));
    }
  });

  it("does not let a crafted URL break out of the href attribute", () => {
    // The quote characters terminate the match, so they land in escaped text
    // rather than closing the attribute.
    const html = linkifyHtml(`https://example.com/"onmouseover="alert(1)`);
    expect(html).toContain('href="https://example.com/"');
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;onmouseover=&quot;alert(1)");
  });

  it("escapes a script tag wrapped around a URL", () => {
    const html = linkifyHtml("<script>https://example.com/</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://example.com/"');
  });

  it("escapes an ampersand inside the URL and stops the match at markup", () => {
    // `&` is a legal URL character so it stays in the link, escaped in both
    // the href and the text; `<` ends the match and is escaped outside it.
    const html = linkifyHtml("https://example.com/?a=1&b=2<>");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain(">https://example.com/?a=1&amp;b=2</a>&lt;&gt;");
    expect(html).not.toContain("<>");
  });
});
