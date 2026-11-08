import { describe, expect, it } from "vitest";

import {
  adverse,
  adverseTail,
  type DecisionInputs,
  gridAt,
  moneyAmount,
  parsePrice,
  parseTonnes,
  parseVolume,
  pnlVsToday,
  profile,
  targetPosition,
  toTonnes,
} from "./decision";

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

  it("parses sacks and converts them to tonnes", () => {
    expect(parseVolume("20.000", "pt-BR", "sc")).toEqual({ ok: true, value: 20000 });
    expect(toTonnes(20000, "sc", 60)).toBe(1200);
    expect(toTonnes(500, "t", 60)).toBe(500);
    const bad = parseVolume("x", "pt-BR", "sc");
    expect(bad.ok === false && bad.error).toContain("sacas");
  });

  it("flags the tail that hurts the chosen side only", () => {
    const cov = { tail_warn_lo80: false, tail_warn_hi80: true, validation: { miss_lo80: 0.08, miss_hi80: 0.19 } };
    expect(adverseTail(cov, "producer")).toEqual({ miss: 0.08, warn: false });
    expect(adverseTail(cov, "buyer")).toEqual({ miss: 0.19, warn: true });
  });

  it("places a target among the readout levels, never as a probability", () => {
    const grid = { levels: [0.1, 0.25, 0.5, 0.75, 0.9], c_bu: [900, 950, 1000, 1050, 1100] };
    const at = (l: number) => gridAt(grid, l);
    const levels = [0.1, 0.25, 0.5, 0.75, 0.9];
    expect(targetPosition(1020, levels, at)).toEqual({ kind: "between", lo: 0.5, hi: 0.75 });
    expect(targetPosition(1000, levels, at)).toEqual({ kind: "between", lo: 0.25, hi: 0.5 });
    expect(targetPosition(850, levels, at)).toEqual({ kind: "below", level: 0.1 });
    expect(targetPosition(1200, levels, at)).toEqual({ kind: "above", level: 0.9 });
    expect(gridAt(grid, 0.3)).toBeNull();
  });

  it("parses target prices with either decimal mark", () => {
    expect(parsePrice("")).toEqual({ ok: true, value: null });
    expect(parsePrice("1,180")).toEqual({ ok: true, value: 1180 });
    expect(parsePrice("132.5")).toEqual({ ok: true, value: 132.5 });
    expect(parsePrice("132,50", "pt-BR")).toEqual({ ok: true, value: 132.5 });
    expect(parsePrice("1.180", "pt-BR")).toEqual({ ok: true, value: 1180 });
    expect(parsePrice("132.50", "pt-BR")).toEqual({ ok: true, value: 132.5 });
    expect(parsePrice("-3").ok).toBe(false);
  });
});
