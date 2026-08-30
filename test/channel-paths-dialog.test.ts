import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_PATHS_DIALOG_TAG,
  MushroomMeshcoreChannelPathsDialog,
  channelPathsDialogImport,
  ensureChannelPathsDialog,
  type ChannelPathContact,
  type ChannelPathsDialogParams,
} from "../src/channel-paths-dialog.js";
import type { LocalizeFunc } from "../src/localize.js";

const strings: Record<string, string> = {
  "card.channel_paths_inference_warning":
    "Repeater identities are inferred from locally known contacts and are not authenticated.",
  "card.channel_path_number": "Path {n}",
  "card.channel_hop_one": "1 hop",
  "card.channel_hops_count": "{n} hops",
  "card.channel_byte_one": "1 byte",
  "card.channel_bytes_count": "{n} bytes",
  "card.channel_direct": "Direct",
  "card.channel_unknown_repeater": "Unknown repeater",
  "card.channel_ambiguous_repeaters": "Ambiguous — {n} known repeaters",
  "card.channel_candidates_more": "+{n} more",
};

const t: LocalizeFunc = (key, vars) => {
  const value = strings[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars?.[name] ?? `{${name}}`)
  );
};

const baseParams = (
  overrides: Partial<ChannelPathsDialogParams> = {}
): ChannelPathsDialogParams => ({
  title: "Message paths (1)",
  routes: [{ hopCount: 1, pathSegments: ["AA"], hashSizeBytes: 1 }],
  contacts: [],
  localize: t,
  closeLabel: "Close",
  ...overrides,
});

function createDialog(
  params?: ChannelPathsDialogParams,
  useLegacySetter = false
): MushroomMeshcoreChannelPathsDialog {
  ensureChannelPathsDialog();
  const dialog = document.createElement(
    CHANNEL_PATHS_DIALOG_TAG
  ) as MushroomMeshcoreChannelPathsDialog;
  if (params && !useLegacySetter) dialog.params = params;
  document.body.appendChild(dialog);
  if (params && useLegacySetter) dialog.showDialog(params);
  return dialog;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("channel message paths dialog", () => {
  it("registers through Home Assistant's dialog loader and supports both parameter lifecycles", async () => {
    await channelPathsDialogImport();
    expect(customElements.get(CHANNEL_PATHS_DIALOG_TAG)).toBe(
      MushroomMeshcoreChannelPathsDialog
    );

    const dialog = createDialog(baseParams(), true);
    expect(dialog.dialogNext).toBe(true);
    expect(dialog.params?.title).toBe("Message paths (1)");
    expect(dialog.shadowRoot!.querySelector("dialog")).not.toBeNull();
  });

  it("renders unique direct, one-, two-, and three-byte paths with exact, unknown, and ambiguous identities", () => {
    const contacts: ChannelPathContact[] = [
      { publicKey: "ABCD9999", name: "Richmond" },
      { publicKey: "12340000", name: "One" },
      { publicKey: "12341111", name: "Two" },
      { publicKey: "12342222", name: "Three" },
      { publicKey: "12343333", name: "Four" },
      { publicKey: "12343333", name: "Ignored duplicate" },
      { publicKey: "AA", name: "Prefix one", keyIsPrefix: true },
      { publicKey: "AA", name: "Prefix two", keyIsPrefix: true },
      { publicKey: "AA", name: "Prefix one", keyIsPrefix: true },
      { publicKey: "GG", name: "Invalid key" },
      { publicKey: "ABC", name: "Odd key" },
      { publicKey: "AA00", name: "" },
      { publicKey: "AA00", name: "x".repeat(513) },
      { publicKey: "AA".repeat(65), name: "Too long" },
      { publicKey: 4, name: "Wrong type" } as unknown as ChannelPathContact,
      null as unknown as ChannelPathContact,
    ];
    const dialog = createDialog(baseParams({
      title: "Message paths (4)",
      contacts,
      routes: [
        {
          hopCount: 3,
          pathSegments: ["abcd", "1234", "ffff"],
          hashSizeBytes: 2,
        },
        {
          hopCount: 3,
          pathSegments: ["ABCD", "1234", "FFFF"],
          hashSizeBytes: 2,
        },
        { hopCount: 0, pathSegments: [] },
        { hopCount: 1, pathSegments: ["aa"], hashSizeBytes: 1 },
        { hopCount: 1, pathSegments: ["A1B2C3"], hashSizeBytes: 3 },
        { hopCount: 1, pathSegments: ["BAD"], hashSizeBytes: 2 },
        { hopCount: 1, pathSegments: ["AA"] },
        { hopCount: -1, pathSegments: [], direct: true },
        { hopCount: 1, pathSegments: [], direct: true },
        null as unknown as { hopCount: number; pathSegments: string[] },
        { hopCount: 1, pathSegments: null } as unknown as {
          hopCount: number;
          pathSegments: string[];
        },
      ],
    }));

    const sections = dialog.shadowRoot!.querySelectorAll(".message-path");
    expect(sections).toHaveLength(4);
    expect(Array.from(dialog.shadowRoot!.querySelectorAll(".message-path-title"))
      .map((heading) => heading.textContent?.trim())).toEqual([
      "Path 1 · 3 hops · 2 bytes",
      "Path 2 · Direct",
      "Path 3 · 1 hop · 1 byte",
      "Path 4 · 1 hop · 3 bytes",
    ]);
    expect(dialog.shadowRoot!.querySelector(".message-path-direct")?.textContent)
      .toBe("Direct");
    expect(Array.from(dialog.shadowRoot!.querySelectorAll(".message-path-hash"))
      .map((hash) => hash.textContent)).toEqual([
      "ABCD", "1234", "FFFF", "AA", "A1B2C3",
    ]);
    expect(dialog.shadowRoot!.querySelector(".message-path-name")?.textContent)
      .toBe("— Richmond");
    expect(dialog.shadowRoot!.textContent).toContain(
      "Ambiguous — 4 known repeaters"
    );
    expect(dialog.shadowRoot!.textContent).toContain(
      "Ambiguous — 2 known repeaters"
    );
    expect(dialog.shadowRoot!.textContent).toContain("Unknown repeater");
    expect(Array.from(dialog.shadowRoot!.querySelectorAll(
      '[data-hop-index="1"] .message-path-candidate'
    )).map((candidate) => candidate.textContent)).toEqual(["One", "Two", "Three"]);
    expect(dialog.shadowRoot!.querySelector(
      '[data-hop-index="1"] .message-path-more'
    )?.textContent).toBe("+1 more");
    expect(Array.from(dialog.shadowRoot!.querySelectorAll(
      '[data-path-index="2"] .message-path-candidate'
    )).map((candidate) => candidate.textContent)).toEqual([
      "Prefix one",
      "Prefix two",
    ]);
    expect(dialog.shadowRoot!.querySelector(".message-path-hash")?.getAttribute("dir"))
      .toBe("ltr");
  });

  it("bounds the route and hop collections before rendering", () => {
    const tooManyHops = Array.from({ length: 65 }, () => "AA");
    const routes = Array.from({ length: 70 }, (_, index) => ({
      hopCount: 1,
      pathSegments: [index.toString(16).padStart(2, "0").slice(-2)],
      hashSizeBytes: 1 as const,
    }));
    routes.splice(1, 0, {
      hopCount: 1,
      pathSegments: tooManyHops,
      hashSizeBytes: 1,
    });
    const dialog = createDialog(baseParams({ routes }));

    // Only the first 64 inputs are considered, and the overlong route is omitted.
    expect(dialog.shadowRoot!.querySelectorAll(".message-path")).toHaveLength(63);
  });

  it("escapes titles, translations, and contact names while isolating bidirectional names", () => {
    const hostileLocalize: LocalizeFunc = (key, vars) => {
      if (key === "card.channel_paths_inference_warning") {
        return '<img src=x onerror="window.pwned=1">\u202E';
      }
      return t(key, vars);
    };
    const dialog = createDialog(baseParams({
      title: '<img src=x onerror="window.pwned=2">',
      closeLabel: 'Close"><img src=x>',
      localize: hostileLocalize,
      contacts: [{ publicKey: "AA00", name: '<script>bad()</script>\u202EName' }],
    }));

    expect(dialog.shadowRoot!.querySelector("img, script")).toBeNull();
    expect(dialog.shadowRoot!.querySelector(".fallback-title")?.textContent)
      .toBe('<img src=x onerror="window.pwned=2">');
    expect(dialog.shadowRoot!.querySelector(".paths-warning")?.textContent)
      .toContain("<img src=x");
    expect(dialog.shadowRoot!.querySelector(".message-path-name")?.textContent)
      .toBe("— <script>bad()</script>\u202EName");
    expect(dialog.shadowRoot!.querySelector(".message-path-name")?.tagName)
      .toBe("SPAN");
    expect(dialog.shadowRoot!.querySelector(".message-path-name bdi")?.textContent)
      .toBe("<script>bad()</script>\u202EName");
    expect(dialog.shadowRoot!.querySelector(".fallback-close")?.getAttribute("title"))
      .toBe('Close"><img src=x>');
  });

  it("updates names from optional asynchronous contacts and ignores failures", async () => {
    const enrichment = deferred<readonly ChannelPathContact[]>();
    const dialog = createDialog(baseParams({
      routes: [{
        hopCount: 3,
        pathSegments: ["AA", "BB", "CC"],
        hashSizeBytes: 1,
      }],
      contacts: [
        { publicKey: "AA", name: "Hilltop", keyIsPrefix: true },
        { publicKey: "BB00", name: "Old name" },
        { publicKey: "CC0011", name: "Same name" },
        { publicKey: "DD", name: "Same prefix", keyIsPrefix: true },
      ],
      contactsPromise: enrichment.promise,
    }));

    enrichment.resolve([
      { publicKey: "aa001122", name: "Hilltop" },
      { publicKey: "BB00", name: "New name" },
      { publicKey: "CC", name: "Same name", keyIsPrefix: true },
      { publicKey: "DD", name: "Same prefix", keyIsPrefix: true },
    ]);
    await enrichment.promise;
    await Promise.resolve();
    expect(dialog.shadowRoot!.textContent).toContain("Hilltop");
    expect(dialog.shadowRoot!.textContent).toContain("New name");
    expect(dialog.shadowRoot!.textContent).not.toContain("Old name");
    expect(dialog.shadowRoot!.textContent).not.toContain("Ambiguous");

    const failed = deferred<readonly ChannelPathContact[]>();
    dialog.params = baseParams({ contactsPromise: failed.promise });
    failed.reject(new Error("service unavailable"));
    await failed.promise.catch(() => undefined);
    await Promise.resolve();
    expect(dialog.isConnected).toBe(true);
    expect(dialog.shadowRoot!.textContent).toContain("Unknown repeater");
  });

  it("ignores stale asynchronous contacts after parameters are replaced or the dialog closes", async () => {
    const oldContacts = deferred<readonly ChannelPathContact[]>();
    const dialog = createDialog(baseParams({ contactsPromise: oldContacts.promise }));
    dialog.params = baseParams({
      routes: [{ hopCount: 1, pathSegments: ["BB"], hashSizeBytes: 1 }],
      contacts: [{ publicKey: "BB00", name: "Current" }],
    });
    oldContacts.resolve([{ publicKey: "AA00", name: "Stale" }]);
    await oldContacts.promise;
    await Promise.resolve();
    expect(dialog.shadowRoot!.textContent).toContain("Current");
    expect(dialog.shadowRoot!.textContent).not.toContain("Stale");

    const afterClose = deferred<readonly ChannelPathContact[]>();
    dialog.params = baseParams({ contactsPromise: afterClose.promise });
    const content = dialog.shadowRoot!.querySelector(
      ".channel-paths-dialog-content"
    )!;
    const beforeClose = content.innerHTML;
    dialog.closeDialog();
    afterClose.resolve([{ publicKey: "AA00", name: "Too late" }]);
    await afterClose.promise;
    await Promise.resolve();
    expect(content.innerHTML).toBe(beforeClose);
    expect(content.textContent).not.toContain("Too late");
  });

  it("keeps asynchronous contact enrichment within the contact bound", async () => {
    const enrichment = deferred<readonly ChannelPathContact[]>();
    const contacts = Array.from({ length: 1024 }, (_, index) => ({
      publicKey: index.toString(16).padStart(4, "0"),
      name: `Contact ${index}`,
    }));
    const dialog = createDialog(baseParams({
      routes: [{ hopCount: 1, pathSegments: ["FF"], hashSizeBytes: 1 }],
      contacts,
      contactsPromise: enrichment.promise,
    }));

    enrichment.resolve([{ publicKey: "FF00", name: "Overflow" }]);
    await enrichment.promise;
    await Promise.resolve();
    expect(dialog.shadowRoot!.textContent).toContain("Unknown repeater");
    expect(dialog.shadowRoot!.textContent).not.toContain("Overflow");
  });

  it.each(["cancel", "scrim", "button"] as const)(
    "closes the fallback through %s and restores focus",
    async (method) => {
      const source = document.createElement("button");
      document.body.appendChild(source);
      source.focus();
      const dialog = createDialog(baseParams({ returnFocus: source }));
      const closed = vi.fn();
      dialog.addEventListener("dialog-closed", closed);
      const surface = dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
      await Promise.resolve();
      expect(dialog.shadowRoot!.activeElement).toBe(
        surface.querySelector(".fallback-close")
      );

      const target = method === "button"
        ? surface.querySelector(".fallback-close")!
        : surface;
      target.dispatchEvent(method === "cancel"
        ? new Event("cancel", { cancelable: true })
        : new MouseEvent("click", { bubbles: true }));

      expect(closed).toHaveBeenCalledTimes(1);
      expect((closed.mock.calls[0][0] as CustomEvent).detail).toEqual({
        dialog: CHANNEL_PATHS_DIALOG_TAG,
      });
      expect(dialog.isConnected).toBe(false);
      expect(document.activeElement).toBe(source);
      expect(dialog.closeDialog()).toBe(true);
      (dialog as unknown as { _finishClose(): void })._finishClose();
      expect(closed).toHaveBeenCalledTimes(1);
    }
  );

  it("restores focus to a replacement control resolved when the dialog closes", () => {
    const original = document.createElement("button");
    const replacement = document.createElement("button");
    document.body.append(original, replacement);
    const resolveReturnFocus = vi.fn(() => replacement);
    const dialog = createDialog(baseParams({
      returnFocus: original,
      resolveReturnFocus,
    }));
    original.remove();

    expect(dialog.closeDialog()).toBe(true);

    expect(resolveReturnFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(replacement);
  });

  it("falls back to the original control when the focus resolver fails", () => {
    const original = document.createElement("button");
    document.body.appendChild(original);
    const dialog = createDialog(baseParams({
      returnFocus: original,
      resolveReturnFocus: () => {
        throw new Error("replacement unavailable");
      },
    }));

    expect(dialog.closeDialog()).toBe(true);
    expect(document.activeElement).toBe(original);
  });

  it("opens without a restorable active element", () => {
    const activeElement = vi.spyOn(document, "activeElement", "get")
      .mockReturnValue(null);
    const dialog = createDialog(baseParams());
    activeElement.mockRestore();

    expect(dialog.shadowRoot!.textContent).toContain(
      "max-height: calc(min(80vh, 720px) - 56px)"
    );
    expect(dialog.closeDialog()).toBe(true);
    expect(dialog.isConnected).toBe(false);
  });

  it("closes an uninitialized or non-open fallback exactly once", () => {
    const uninitialized = createDialog();
    const uninitializedClosed = vi.fn();
    uninitialized.addEventListener("dialog-closed", uninitializedClosed);
    expect(uninitialized.closeDialog()).toBe(true);
    expect(uninitialized.closeDialog()).toBe(true);
    expect(uninitializedClosed).toHaveBeenCalledTimes(1);

    const dialog = createDialog(baseParams());
    const closed = vi.fn();
    dialog.addEventListener("dialog-closed", closed);
    dialog.shadowRoot!.querySelector("dialog")!.removeAttribute("open");
    expect(dialog.closeDialog()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("still closes when the source control can no longer accept focus", () => {
    const source = document.createElement("button");
    document.body.appendChild(source);
    vi.spyOn(source, "focus").mockImplementation(() => {
      throw new Error("inert source");
    });
    const dialog = createDialog(baseParams({ returnFocus: source }));

    expect(dialog.closeDialog()).toBe(true);
    expect(dialog.isConnected).toBe(false);
  });

  it("falls back to the native open attribute when showModal throws", () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => {
      throw new Error("not supported");
    });
    const dialog = createDialog(baseParams());
    expect(dialog.shadowRoot!.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("falls back to the native open attribute when showModal is unavailable", () => {
    const prototype = HTMLDialogElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "showModal");
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      const dialog = createDialog(baseParams());
      expect(dialog.shadowRoot!.querySelector("dialog")?.hasAttribute("open"))
        .toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(prototype, "showModal", descriptor);
      else delete (prototype as unknown as { showModal?: unknown }).showModal;
    }
  });

  it("uses Home Assistant's adaptive lifecycle and refreshes its content", async () => {
    class TestAdaptiveDialog extends HTMLElement {
      open = false;
      width = "medium";
      headerTitle = "";
    }
    if (!customElements.get("ha-adaptive-dialog")) {
      customElements.define("ha-adaptive-dialog", TestAdaptiveDialog);
    }
    const enrichment = deferred<readonly ChannelPathContact[]>();
    const dialog = createDialog(baseParams({
      title: "Message paths (1)",
      contactsPromise: enrichment.promise,
    }));
    const surface = dialog.shadowRoot!.querySelector<TestAdaptiveDialog>(
      "ha-adaptive-dialog"
    )!;
    const closed = vi.fn();
    dialog.addEventListener("dialog-closed", closed);

    expect(surface.open).toBe(true);
    expect(surface.width).toBe("small");
    expect(surface.headerTitle).toBe("Message paths (1)");
    enrichment.resolve([{ publicKey: "AA00", name: "Adaptive contact" }]);
    await enrichment.promise;
    await Promise.resolve();
    expect(surface.textContent).toContain("Adaptive contact");

    expect(dialog.closeDialog()).toBe(true);
    expect(surface.open).toBe(false);
    expect(dialog.isConnected).toBe(true);
    surface.dispatchEvent(new Event("closed"));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(dialog.isConnected).toBe(false);
  });
});
