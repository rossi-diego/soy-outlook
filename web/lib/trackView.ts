// The /track-record/ view model, built at build time from track_record.json. The page used to
// embed the whole file (about 300 KB, every path row with every quantile); the client only
// needs the 3 path models x 3 horizons, in USD/t, rounded, plus the summary statistics.
// Keeping this a pure function lets vitest pin its size and shape.
import type { MetricRow, ModelId, TrackRecord } from "./types";

export const PATH_MODELS = ["rw", "arima", "ridge"] as const satisfies readonly ModelId[];
export const HORIZONS = [1, 3, 6] as const;
const PATH_FIELDS = ["f", "lo", "hi"] as const;

type PathModel = (typeof PATH_MODELS)[number];

/**
 * One horizon, column-wise: a shared date axis, the actual, and each model's forecast and 80%
 * range. Dates are whole days since 1970-01-01 (UTC) and the per-row flags are one character
 * each, which roughly halves the embedded payload; `isoDay` turns a day back into a date.
 */
export type PathColumns = {
  /** Target dates, days since 1970-01-01 (UTC), ascending. */
  t: number[];
  /** One character per row: "v" validation, "h" holdout, "o" other out-of-sample rows. */
  split: string;
  /** Realized CBOT, USD/t (null while pending). */
  actual: (number | null)[];
  /** One character per row: "1" when the continuous front month rolls inside the window. */
  roll: string;
  /** One character per row: "1" when the window crosses an old-crop to new-crop roll. */
  crop: string;
  models: Record<PathModel, { f: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }>;
};

export type SlimMetric = Pick<
  MetricRow,
  | "split"
  | "model"
  | "h"
  | "n"
  | "mae_usd_t"
  | "mase"
  | "cover80"
  | "cover95"
  | "mde_mae"
  | "cover80_ci_lo"
  | "cover80_ci_hi"
  | "cover80_n_eff"
  | "cover95_ci_lo"
  | "cover95_ci_hi"
  | "cover95_n_eff"
  | "miss_lo80"
  | "miss_hi80"
  | "miss_lo95"
  | "miss_hi95"
  | "kupiec80_p"
  | "christ80_p"
  | "kupiec95_p"
  | "christ95_p"
>;

export type TrackView = {
  metrics: SlimMetric[];
  tests: TrackRecord["tests"];
  fob: TrackRecord["fob_illustrative"];
  fobNote: string | null;
  rangeChoice: TrackRecord["range_choice"];
  /** Hit rates of each range candidate (no change), by split and horizon. */
  rangeDiag: { method: string; split: string; h: number; c80: number; c95: number }[];
  paths: Record<string, PathColumns>;
};

const DAY_MS = 86_400_000;
export const toDay = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS);
export const isoDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

const r1 = (v: number | null | undefined, k: number) => (v === null || v === undefined ? null : Math.round(v * k * 10) / 10);
const r4 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4);
const r3 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1e3) / 1e3);

function slimMetric(r: MetricRow): SlimMetric {
  const out = {} as Record<string, unknown>;
  const keys: (keyof SlimMetric)[] = [
    "split", "model", "h", "n", "mae_usd_t", "mase", "cover80", "cover95", "mde_mae",
    "cover80_ci_lo", "cover80_ci_hi", "cover80_n_eff", "cover95_ci_lo", "cover95_ci_hi", "cover95_n_eff",
    "miss_lo80", "miss_hi80", "miss_lo95", "miss_hi95", "kupiec80_p", "christ80_p", "kupiec95_p", "christ95_p",
  ];
  for (const k of keys) {
    const v = r[k];
    out[k] = typeof v === "number" && !Number.isInteger(v) ? r3(v) : v;
  }
  return out as SlimMetric;
}

/** Column-wise paths in USD/t (k = bushels per tonne / 100), one decimal. */
export function pathColumns(track: TrackRecord, h: number, k: number): PathColumns {
  const byModel = track.paths[String(h)] ?? {};
  const dates = new Set<string>();
  for (const m of PATH_MODELS) for (const r of byModel[m] ?? []) dates.add(r.target_date);
  const t = [...dates].sort();
  const idx = new Map(t.map((d, i) => [d, i]));
  const split = t.map(() => "o");
  const roll = t.map(() => "0");
  const crop = t.map(() => "0");
  const col: Omit<PathColumns, "split" | "roll" | "crop"> = {
    t: t.map(toDay),
    actual: t.map(() => null),
    models: Object.fromEntries(
      PATH_MODELS.map((m) => [m, Object.fromEntries(PATH_FIELDS.map((f) => [f, t.map(() => null)]))]),
    ) as PathColumns["models"],
  };
  for (const m of PATH_MODELS) {
    for (const r of byModel[m] ?? []) {
      const i = idx.get(r.target_date)!;
      split[i] = r.split === "validation" ? "v" : r.split === "holdout" ? "h" : "o";
      if (r.actual !== null) col.actual[i] = r1(r.actual, k);
      roll[i] = r.roll_cross ? "1" : "0";
      crop[i] = r.crop_roll ? "1" : "0";
      col.models[m].f[i] = r1(r.forecast, k);
      col.models[m].lo[i] = r1(r.q10, k);
      col.models[m].hi[i] = r1(r.q90, k);
    }
  }
  return { ...col, split: split.join(""), roll: roll.join(""), crop: crop.join("") };
}

export function buildTrackView(track: TrackRecord, buPerT: number): TrackView {
  const k = buPerT / 100;
  return {
    metrics: track.metrics.filter((r) => r.subset === "all").map(slimMetric),
    tests: track.tests.map((r) => ({
      ...r,
      dm_t: r4(r.dm_t),
      dm_p: r4(r.dm_p),
      dm_mae_t: r4(r.dm_mae_t),
      dm_mae_p: r4(r.dm_mae_p),
      cw_t: r4(r.cw_t),
      cw_p: r4(r.cw_p),
      cw_p_holm: r4(r.cw_p_holm),
    })) as TrackRecord["tests"],
    fob: track.fob_illustrative,
    fobNote: track.fob_illustrative_note,
    rangeChoice: track.range_choice,
    rangeDiag: track.range_diagnostics
      .filter((r) => r.model === "rw")
      .map((r) => ({ method: r.method, split: r.split, h: r.h, c80: r3(r.cover80) ?? NaN, c95: r3(r.cover95) ?? NaN })),
    paths: Object.fromEntries(HORIZONS.map((h) => [String(h), pathColumns(track, h, k)])),
  };
}

/**
 * "% MAE vs no change" with an approximate 95% interval from the Diebold-Mariano statistic on
 * the same absolute USD/t errors: se(d) = d / t_DM, so the interval is d +/- 1.96 d / t_DM.
 * Returns null bounds when the statistic is missing, zero or of the opposite sign to d.
 */
export function maeVsNoChange(mase: number | null | undefined, dmMaeT: number | null | undefined) {
  if (mase === null || mase === undefined || Number.isNaN(mase)) return null;
  const d = (mase - 1) * 100;
  if (dmMaeT === null || dmMaeT === undefined || !Number.isFinite(dmMaeT) || dmMaeT === 0 || Math.sign(dmMaeT) !== Math.sign(d)) {
    return { d, lo: null, hi: null };
  }
  const se = d / dmMaeT;
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se };
}
