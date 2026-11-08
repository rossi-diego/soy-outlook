import { describe, expect, it } from "vitest";

import { type Assumptions, convert, heldText, money, moveHitText, parseFx, rangeLabel, signed } from "./format";

const BU_PER_T = 36.74371036414626;
const a: Assumptions = { premium: 79, fx: 5.5, buPerT: BU_PER_T, sackKg: 60 };

describe("convert", () => {
  it("leaves CBOT cents per bushel untouched, whatever the premium", () => {
    expect(convert(1189, "c_bu", a)).toBe(1189);
    expect(convert(1189, "c_bu", { ...a, premium: -50 })).toBe(1189);
  });

  it("adds the premium before converting to USD per tonne", () => {
    expect(convert(1189, "usd_t", a)).toBeCloseTo(((1189 + 79) / 100) * BU_PER_T, 10);
    expect(convert(1189, "usd_t", { ...a, premium: 0 })).toBeCloseTo(11.89 * BU_PER_T, 10);
  });

  it("converts FOB USD/t to reais per 60 kg sack at the given FX", () => {
    const usdT = ((1189 + 79) / 100) * BU_PER_T;
    expect(convert(1189, "brl_sack", a)).toBeCloseTo((usdT * 60 * 5.5) / 1000, 10);
  });

  it("is linear in the CBOT price, so a premium is a constant shift", () => {
    const d1 = convert(1200, "usd_t", a) - convert(1100, "usd_t", a);
    const d2 = convert(1200, "usd_t", { ...a, premium: 150 }) - convert(1100, "usd_t", { ...a, premium: 150 });
    expect(d1).toBeCloseTo(d2, 10);
    expect(d1).toBeCloseTo(BU_PER_T, 10);
  });

  it("handles a negative premium and zero FX without NaN", () => {
    expect(convert(1000, "usd_t", { ...a, premium: -100 })).toBeCloseTo(9 * BU_PER_T, 10);
    expect(convert(1000, "brl_sack", { ...a, fx: 0 })).toBe(0);
  });
});

describe("parseFx", () => {
  it("accepts a dot or a comma and trims spaces", () => {
    expect(parseFx("5.50")).toEqual({ ok: true, value: 5.5 });
    expect(parseFx(" 5,4321 ")).toEqual({ ok: true, value: 5.4321 });
  });

  it("rejects text, empty input and rates outside 3-9", () => {
    for (const t of ["", "abc", "5.", "2.99", "9.01", "-5"]) expect(parseFx(t).ok).toBe(false);
    expect(parseFx("3").ok).toBe(true);
    expect(parseFx("9").ok).toBe(true);
  });
});

describe("labels", () => {
  const cov = {
    nominal: { "80": 0.8, "95": 0.95 },
    validation: { years: "2016-23", cover80: 0.708, cover95: 0.888 },
    holdout: { years: "2024+", cover80: 0.85, cover95: 1 },
  };
  it("builds the range label from the measured hit rates", () => {
    expect(rangeLabel(cov, "80")).toBe("80% range (held 71% in 2016-23, 85% in 2024+)");
    expect(heldText({ ...cov, validation: null, holdout: null }, "95")).toBe("hit rate not available yet");
  });
  it("formats money and signed values", () => {
    expect(money(466.2, "usd_t")).toBe("$466/t");
    expect(money(null, "c_bu")).toBe("—");
    expect(signed(-1.24, 1)).toBe("−1.2");
    expect(signed(0.01, 1)).toBe("unch.");
  });
});

describe("release-day move hit rate (P14)", () => {
  it("states the out-of-sample hit rate with its Wilson interval", () => {
    const s = { years: "2016-2023", n: 86, hit50: 0.5, ci50: [0.397, 0.603] as [number, number], hit90: 0.895, ci90: [0.813, 0.944] as [number, number] };
    expect(moveHitText(s, "50")).toBe("50% of 86 reports in 2016-2023 (likely 40%–60%)");
    expect(moveHitText(s, "90")).toBe("90% of 86 reports in 2016-2023 (likely 81%–94%)");
    expect(moveHitText({ ...s, n: 0, hit50: null, ci50: null }, "50")).toBe("no reports yet in 2016-2023");
  });
});
