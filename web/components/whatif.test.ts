import { describe, expect, it } from "vitest";

import { predictionInterval, sliderRange, typicalRevText } from "./WasdeWhatIf";

describe("sliderRange", () => {
  it("uses the realistic base range when history and the latest revision fit in it", () => {
    expect(sliderRange("pp", 0.8, 0.09)).toBe(1);
    expect(sliderRange("Mt", 2, 0)).toBe(3);
  });
  it("widens only as far as the 1-in-10 revision or the latest revision needs", () => {
    expect(sliderRange("pp", 2.07, 0.09)).toBe(2.5);
    expect(sliderRange("pp", 1.53, 1.66)).toBe(2);
    expect(sliderRange("Mt", 3.72, null)).toBe(4);
  });
});

describe("predictionInterval", () => {
  it("is ±z·sd_resid with no input", () => {
    const pi = predictionInterval([1, 2], [[0.1, 0], [0, 0.1]], 6.839, [0, 0]);
    expect(pi.mean).toBe(0);
    expect(pi.hi).toBeCloseTo(1.2815515655446004 * 6.839, 6);
  });
  it("adds m'Vm to the residual variance", () => {
    const pi = predictionInterval([-2, 0], [[0.75, 0], [0, 1]], 3, [1, 0]);
    expect(pi.mean).toBe(-2);
    expect(pi.sd).toBeCloseTo(Math.sqrt(0.75 + 9), 10);
  });
});

describe("typicalRevText", () => {
  it("prints median, 1-in-10 and latest revisions with units", () => {
    expect(typicalRevText("pp", 0.41, 2.07, 0.09)).toBe("Typical revision ±0.41 pp · 1 in 10 beyond ±2.07 pp · latest +0.09 pp");
  });
  it("says 'usually unchanged' for a zero median and 'latest unchanged' for a zero revision", () => {
    expect(typicalRevText("Mt", 0, 2, 0)).toBe("Usually unchanged · 1 in 10 beyond ±2.0 Mt · latest unchanged");
  });
  it("handles missing statistics", () => {
    expect(typicalRevText("Mt", null, null, null)).toBe("Typical revision —");
  });
});

describe("typical revision text in pt-BR", () => {
  it("keeps the numbers and translates the words", () => {
    expect(typicalRevText("Mt", 0, 2, 0, "pt-BR")).toBe("Normalmente sem mudança · 1 em 10 além de ±2,0 Mt · última sem mudança");
    expect(typicalRevText("pp", 0.5, 2.07, -0.3, "pt-BR")).toBe("Revisão típica ±0,50 pp · 1 em 10 além de ±2,07 pp · última −0,30 pp");
  });
});
