import { describe, expect, it } from "vitest";

import { predictionInterval, sliderRange } from "./WasdeWhatIf";

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
