import { describe, expect, it } from "vitest";

import { adverse, type DecisionInputs, moneyAmount, parseTonnes, pnlVsToday, profile } from "./decision";

const BU = 36.7437;
const base: DecisionInputs = { side: "producer", tonnes: 1000, hedge: 0, currency: "usd", fx: 5, buPerT: BU };
const h = {
  q025: 900,
  q100: 950,
  q900: 1100,
  q975: 1150,
  grid: { levels: [0.05, 0.1, 0.5, 0.9, 0.95], c_bu: [930, 950, 1000, 1100, 1120] },
};

describe("decision panel", () => {
  it("prices a producer's downside vs selling today", () => {
    // 50 c/bu lower on 1,000 t = 0.5 USD/bu x 36.74 bu/t x 1,000 t
    expect(pnlVsToday(950, 1000, base)).toBeCloseTo(-0.5 * BU * 1000, 6);
  });

  it("mirrors the sign for a buyer and scales by the open share and FX", () => {
    const buyer = { ...base, side: "buyer" as const, hedge: 0.75, currency: "brl" as const };
    expect(pnlVsToday(1100, 1000, buyer)).toBeCloseTo(-1 * BU * 250 * 5, 6);
    expect(pnlVsToday(950, 1000, buyer)).toBeGreaterThan(0);
    expect(pnlVsToday(500, 1000, { ...base, hedge: 1 })).toBeCloseTo(0, 9);
  });

  it("picks the adverse tail for each side", () => {
    expect(adverse(h, "producer")).toEqual({ oneInTen: 950, oneInForty: 900 });
    expect(adverse(h, "buyer")).toEqual({ oneInTen: 1100, oneInForty: 1150 });
  });

  it("orders the grid profile from worst to best", () => {
    for (const side of ["producer", "buyer"] as const) {
      const p = profile(h, 1000, { ...base, side }).map((r) => r.pnl);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
    }
  });

  it("formats amounts and parses tonnes", () => {
    expect(moneyAmount(-1_234_567, "usd")).toBe("−US$ 1.23M");
    expect(moneyAmount(45_600, "brl")).toBe("+R$ 46k");
    expect(moneyAmount(0.2, "usd")).toBe("US$ 0");
    expect(parseTonnes("5,000")).toEqual({ ok: true, value: 5000 });
    expect(parseTonnes("abc").ok).toBe(false);
    expect(parseTonnes("0").ok).toBe(false);
  });
});
