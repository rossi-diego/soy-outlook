// Event-study stability (polish unit D): which fit the /wasde what-if uses, and the plain-language
// facts behind the "How stable is this?" block. Pure functions over wasde.json, no React.
import type { Wasde } from "@/lib/types";

type Reaction = Wasde["reaction"];
export type FitId = Reaction["whatif_default_fit"];

export type FitItem = {
  feature: string;
  usd_t_per_unit: number;
  se_usd_t: number;
  p_holm: number;
  /** Holm-adjusted p at or above the event study's alpha. */
  weak: boolean;
  /** Sign opposite to the supply-and-demand expectation (flagged, never dropped). */
  wrong_sign: boolean;
};

export type WhatIfFit = {
  id: FitId;
  years: string;
  nReports: number;
  r2: number;
  /** Coefficients in `reaction.features` order. */
  b: number[];
  cov: number[][];
  residSd: number;
  items: FitItem[];
};

/**
 * The coefficients, covariance and residual sd the what-if uses for one fit. "full" is the
 * main event study; "recent" is the split sample's late half refitted on its own, with its own
 * HC1 covariance and residual sd (display rule config.WHATIF_DEFAULT_FIT, 2026-11-08).
 */
export function whatIfFit(reaction: Reaction, id: FitId): WhatIfFit {
  const full = Object.fromEntries(reaction.items.map((it) => [it.feature, it]));
  if (id === "full") {
    const items = reaction.features.map((f) => {
      const it = full[f];
      return { feature: f, usd_t_per_unit: it.usd_t_per_unit, se_usd_t: it.se_usd_t, p_holm: it.p_holm, weak: it.weak, wrong_sign: it.wrong_sign };
    });
    return {
      id,
      years: reaction.years,
      nReports: reaction.n_reports,
      r2: reaction.r2,
      b: items.map((it) => it.usd_t_per_unit),
      cov: reaction.cov_usd_t,
      residSd: reaction.resid_sd_usd_t,
      items,
    };
  }
  const late = reaction.robustness.split_sample.late;
  const byF = Object.fromEntries(late.items.map((it) => [it.feature, it]));
  const items = reaction.features.map((f) => {
    const it = byF[f];
    const sign = Math.sign(it.usd_t_per_unit);
    const expected = full[f]?.expected_sign ?? 0;
    return {
      feature: f,
      usd_t_per_unit: it.usd_t_per_unit,
      se_usd_t: it.se_usd_t,
      p_holm: it.p_holm,
      weak: it.p_holm >= reaction.alpha,
      wrong_sign: sign !== 0 && expected !== 0 && sign !== expected,
    };
  });
  return {
    id,
    years: late.years,
    nReports: late.n_reports,
    r2: late.r2,
    b: items.map((it) => it.usd_t_per_unit),
    cov: late.cov_usd_t,
    residSd: late.resid_sd_usd_t,
    items,
  };
}

/** Two-sided 95% normal quantile: "distinguishable from zero" means |b / se| above it. */
const Z95 = 1.959963984540054;

export type StabilityFacts = {
  /** The revision the summary is about: the full sample's smallest raw p (its strongest line). */
  feature: string;
  label: string;
  unit: string;
  full: { b: number; se: number };
  breakYear: number;
  early: { years: string; b: number; se: number; n: number };
  late: { years: string; b: number; se: number; n: number; zero: boolean };
  diffP: number;
  /** The split-sample difference for this line is significant at the event study's alpha. */
  broke: boolean;
  roll: { b: number; se: number; zero: boolean; jointP: number; jointZero: boolean; nExcluded: number; nLeft: number; bdays: number };
  placebo: { jointP: number; clean: boolean; lag: number };
  /** Every line whose split-sample difference p is below alpha. */
  unstable: string[];
};

export function stabilityFacts(reaction: Reaction): StabilityFacts {
  const rob = reaction.robustness;
  const main = [...reaction.items].sort((a, b) => a.p_value - b.p_value)[0];
  const f = main.feature;
  const split = rob.split_sample.items.find((it) => it.feature === f)!;
  const roll = rob.roll_excluded.items.find((it) => it.feature === f)!;
  const zero = (b: number, se: number) => se <= 0 || Math.abs(b / se) < Z95;
  return {
    feature: f,
    label: main.label,
    unit: main.unit,
    full: { b: main.usd_t_per_unit, se: main.se_usd_t },
    breakYear: Number(rob.split_sample.break.slice(0, 4)),
    early: { years: rob.split_sample.early.years, b: split.early_usd_t, se: split.early_se_usd_t, n: rob.split_sample.early.n_reports },
    late: {
      years: rob.split_sample.late.years,
      b: split.late_usd_t,
      se: split.late_se_usd_t,
      n: rob.split_sample.late.n_reports,
      zero: zero(split.late_usd_t, split.late_se_usd_t),
    },
    diffP: split.diff_p,
    broke: split.diff_p < reaction.alpha,
    roll: {
      b: roll.usd_t_per_unit,
      se: roll.se_usd_t,
      zero: zero(roll.usd_t_per_unit, roll.se_usd_t),
      jointP: rob.roll_excluded.joint_p,
      jointZero: rob.roll_excluded.joint_p >= reaction.alpha,
      nExcluded: rob.roll_excluded.n_excluded,
      nLeft: rob.roll_excluded.n_reports,
      bdays: rob.roll_excluded.bdays,
    },
    placebo: { jointP: rob.placebo.joint_p, clean: rob.placebo.joint_p >= reaction.alpha, lag: rob.placebo.lag_sessions },
    unstable: rob.split_sample.items.filter((it) => it.diff_p < reaction.alpha).map((it) => it.feature),
  };
}
