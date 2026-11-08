import { describe, expect, it } from "vitest";

import { convert, unitLong } from "./format";
import { PREMIUM_MAX, PREMIUM_MIN, parsePremium, premiumInputText } from "./premium";

describe("parsePremium (the premium is a user input only)", () => {
  it("treats empty as no premium (CBOT only)", () => {
    expect(parsePremium("")).toEqual({ ok: true, value: null });
    expect(parsePremium("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts signs, a true minus and a decimal comma", () => {
    expect(parsePremium("80")).toEqual({ ok: true, value: 80 });
    expect(parsePremium("+80")).toEqual({ ok: true, value: 80 });
    expect(parsePremium("-12")).toEqual({ ok: true, value: -12 });
    expect(parsePremium("−12")).toEqual({ ok: true, value: -12 });
    expect(parsePremium("82,5", "pt-BR")).toEqual({ ok: true, value: 82.5 });
    expect(parsePremium(String(PREMIUM_MIN))).toEqual({ ok: true, value: PREMIUM_MIN });
    expect(parsePremium(String(PREMIUM_MAX))).toEqual({ ok: true, value: PREMIUM_MAX });
  });

  it("rejects text and out-of-range values with a message in the viewer's language", () => {
    const bad = parsePremium("abc");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("Enter a premium between");
    expect(parsePremium(String(PREMIUM_MAX + 1)).ok).toBe(false);
    expect(parsePremium(String(PREMIUM_MIN - 1)).ok).toBe(false);
    const pt = parsePremium("1e3", "pt-BR");
    expect(pt.ok).toBe(false);
    if (!pt.ok) expect(pt.error).toContain("Digite um prêmio");
  });

  it("round-trips through the text field", () => {
    expect(premiumInputText(null)).toBe("");
    expect(premiumInputText(80)).toBe("80");
    expect(premiumInputText(-12.5, "pt-BR")).toBe("-12,50");
    expect(parsePremium(premiumInputText(-12.5, "pt-BR"), "pt-BR")).toEqual({ ok: true, value: -12.5 });
  });
});

describe("no premium = CBOT only", () => {
  const a = { premium: 0, fx: 5.5, buPerT: 36.74371036414626, sackKg: 60 };
  it("converts CBOT alone to USD/t and R$/sack", () => {
    expect(convert(1189, "usd_t", a)).toBeCloseTo(11.89 * a.buPerT, 10);
    expect(convert(1189, "brl_sack", a)).toBeCloseTo((11.89 * a.buPerT * 60 * 5.5) / 1000, 10);
  });
  it("labels the unit as CBOT only, excl. premium, in both languages", () => {
    expect(unitLong("usd_t", "en", false)).toContain("CBOT only, excl. premium");
    expect(unitLong("brl_sack", "pt-BR", false)).toContain("só CBOT, sem prêmio");
    expect(unitLong("usd_t", "en", true)).toContain("Paranaguá FOB");
  });
});
