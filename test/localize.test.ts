import { describe, expect, it } from "vitest";
import { makeLocalize } from "../src/localize.js";
import en from "../src/translations/en.json";
import fr from "../src/translations/fr.json";

describe("makeLocalize", () => {
  it("resolves nested keys for the requested language", () => {
    expect(makeLocalize("en")("card.online")).toBe(en.card.online);
    expect(makeLocalize("fr")("card.online")).toBe(fr.card.online);
  });

  it("falls back to English for unknown languages", () => {
    expect(makeLocalize("xx")("card.online")).toBe(en.card.online);
  });

  it("returns the key itself when no translation exists", () => {
    expect(makeLocalize("en")("card.__does_not_exist")).toBe("card.__does_not_exist");
    expect(makeLocalize("en")("nope")).toBe("nope");
  });

  it("substitutes {placeholders} from vars", () => {
    expect(makeLocalize("en")("time.m_ago", { n: 5 })).toBe(
      en.time.m_ago.replace("{n}", "5")
    );
    expect(makeLocalize("en")("card.target_not_found", { id: "abc" })).toContain(
      "abc"
    );
  });

  it("keeps unresolved placeholders literal", () => {
    expect(makeLocalize("en")("time.m_ago", {})).toBe(en.time.m_ago);
  });

  it("does not treat intermediate objects as translations", () => {
    expect(makeLocalize("en")("card")).toBe("card");
  });
});
