// Complements scripts/check-translations.mjs (which verifies that every en
// key exists in the other locales) by additionally asserting the reverse —
// no orphan keys — plus placeholder and value-shape parity per locale.
import { describe, expect, it } from "vitest";
import en from "../src/translations/en.json";
import fr from "../src/translations/fr.json";
import nl from "../src/translations/nl.json";
import de from "../src/translations/de.json";
import pl from "../src/translations/pl.json";

const LOCALES: Record<string, unknown> = { en, fr, nl, de, pl };

function leafEntries(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (value === null || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object") {
      for (const [childPath, childValue] of leafEntries(child, path)) {
        out.set(childPath, childValue);
      }
    } else if (typeof child === "string") {
      out.set(path, child);
    } else {
      throw new Error(`Unexpected non-string leaf at ${path}: ${typeof child}`);
    }
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

const enLeaves = leafEntries(en);

describe("translation files", () => {
  it("en has translation keys", () => {
    expect(enLeaves.size).toBeGreaterThan(0);
  });

  for (const [lang, dict] of Object.entries(LOCALES)) {
    describe(lang, () => {
      const leaves = leafEntries(dict);

      it("has exactly the same key set as en", () => {
        expect([...leaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
      });

      it("has no empty translations", () => {
        for (const [key, value] of leaves) {
          expect(value.trim(), key).not.toBe("");
        }
      });

      it("keeps every {placeholder} used by en", () => {
        for (const [key, value] of leaves) {
          const reference = enLeaves.get(key);
          if (reference === undefined) continue; // covered by the key-set test
          expect(placeholders(value), key).toEqual(placeholders(reference));
        }
      });
    });
  }
});
