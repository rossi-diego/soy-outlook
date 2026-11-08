import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { predictionInterval } from "../components/WasdeWhatIf";
import { stabilityFacts, whatIfFit } from "./stability";
import type { Wasde } from "./types";

const DATA = path.join(__dirname, "..", "public", "data");
const wasde = JSON.parse(fs.readFileSync(path.join(DATA, "wasde.json"), "utf-8")) as Wasde;
const clone = () => structuredClone(wasde.reaction);

describe("whatIfFit", () => {
  it("full uses the main fit's coefficients, covariance and residual sd", () => {
    const r = wasde.reaction;
    const fit = whatIfFit(r, "full");
    expect(fit.b).toEqual(r.features.map((f) => r.items.find((it) => it.feature === f)!.usd_t_per_unit));
    expect(fit.cov).toBe(r.cov_usd_t);
    expect(fit.residSd).toBe(r.resid_sd_usd_t);
    expect(fit.nReports).toBe(r.n_reports);
  });

  it("recent uses the late half's own covariance and residual sd, in `features` order", () => {
    const r = wasde.reaction;
    const late = r.robustness.split_sample.late;
    const fit = whatIfFit(r, "recent");
    expect(fit.items.map((it) => it.feature)).toEqual(r.features);
    expect(fit.b).toEqual(late.items.map((it) => it.usd_t_per_unit));
    expect(fit.cov).toBe(late.cov_usd_t);
    expect(fit.residSd).toBe(late.resid_sd_usd_t);
    expect(fit.nReports).toBe(late.n_reports);
    // With no surprise the interval is the recent residual noise alone.
    const pi = predictionInterval(fit.b, fit.cov, fit.residSd, fit.b.map(() => 0));
    expect(pi.hi).toBeCloseTo(1.2815515655446004 * late.resid_sd_usd_t, 10);
  });

  it("recent flags weak (Holm) and unexpected-sign coefficients against the full-sample expectation", () => {
    const r = clone();
    const late = r.robustness.split_sample.late;
    late.items[0] = { ...late.items[0], usd_t_per_unit: 3, p_holm: 0.01 };
    const it = whatIfFit(r, "recent").items[0];
    expect(it.weak).toBe(false);
    expect(it.wrong_sign).toBe(r.items[0].expected_sign === -1);
  });

  it("is the published default", () => {
    expect(["recent", "full"]).toContain(wasde.reaction.whatif_default_fit);
  });
});

describe("stabilityFacts", () => {
  it("summarises the strongest full-sample line from the published robustness checks", () => {
    const r = wasde.reaction;
    const s = stabilityFacts(r);
    const strongest = [...r.items].sort((a, b) => a.p_value - b.p_value)[0];
    expect(s.feature).toBe(strongest.feature);
    const sp = r.robustness.split_sample.items.find((it) => it.feature === s.feature)!;
    expect(s.diffP).toBe(sp.diff_p);
    expect(s.broke).toBe(sp.diff_p < r.alpha);
    expect(s.late.zero).toBe(Math.abs(sp.late_usd_t / sp.late_se_usd_t) < 1.96);
    expect(s.roll.jointZero).toBe(r.robustness.roll_excluded.joint_p >= r.alpha);
    const ro = r.robustness.roll_excluded.items.find((it) => it.feature === s.feature)!;
    expect(s.roll.zero).toBe(Math.abs(ro.usd_t_per_unit / ro.se_usd_t) < 1.96);
    expect(s.placebo.clean).toBe(r.robustness.placebo.joint_p >= r.alpha);
    expect(s.breakYear).toBe(Number(r.robustness.split_sample.break.slice(0, 4)));
  });

  it("follows the numbers when the break or the roll null goes away", () => {
    const r = clone();
    const s0 = stabilityFacts(r);
    const sp = r.robustness.split_sample.items.find((it) => it.feature === s0.feature)!;
    sp.diff_p = 0.6;
    sp.late_usd_t = -4;
    sp.late_se_usd_t = 1;
    r.robustness.roll_excluded.joint_p = 0.001;
    const ro = r.robustness.roll_excluded.items.find((it) => it.feature === s0.feature)!;
    ro.usd_t_per_unit = -5;
    ro.se_usd_t = 1;
    r.robustness.placebo.joint_p = 0.01;
    const s = stabilityFacts(r);
    expect(s.broke).toBe(false);
    expect(s.late.zero).toBe(false);
    expect(s.roll.jointZero).toBe(false);
    expect(s.roll.zero).toBe(false);
    expect(s.placebo.clean).toBe(false);
  });
});
