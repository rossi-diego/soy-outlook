// The home page ("Outlook" story) view model, built at build time from the published contract.
// Every number the story shows is either a published value (outlook.json, track_record.json,
// wasde.json, meta.json) or a count of published rows; nothing here estimates a new statistic.
// Only this compact model reaches the client, which keeps the home page inside its 100 KB HTML budget.
import type { Horizon, Meta, ModelId, Outlook, TrackRecord, Wasde } from "./types";
import { toDay } from "./trackView";

/** The story's horizon: the contest, the backtest chart and the hedging hint are all 3 months. */
export const STORY_H = 3;
/** The contest, in the order the copy introduces them. */
export const CONTEST_MODELS = ["rw", "arima", "drift", "ridge"] as const satisfies readonly ModelId[];

export type ContestRow = { model: ModelId; n: number; mae: number; mase: number };

export type StoryView = {
  /** Weekly CBOT closes: days since 1970-01-01 (UTC) and US cents per bushel. */
  history: { t: number[]; c: number[] };
  /** Every scored 3-month no-change 80% range (validation and holdout), USD/t, one decimal. */
  backtest: { t: number[]; lo: number[]; hi: number[]; a: number[]; split: string };
  /** Validation MAE (USD/t) and MASE (MAE relative to no change) at STORY_H, lowest MAE first. */
  contest: ContestRow[];
  /** True when no Holm-adjusted Clark-West p at STORY_H falls below the champion alpha. */
  holmNone: boolean;
  /** The pre-registered stress episodes and their realized STORY_H-month move (%). */
  stress: { id: string; name: string; start: string; pct: number }[];
  /** The release-day move band (wasde.json), USD/t. */
  move: { typical_usd_t: number; one_in_ten_usd_t: number; n: number } | null;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildStoryView(outlook: Outlook, track: TrackRecord, wasde: Wasde, meta: Meta): StoryView {
  const k = meta.consts.bu_per_t / 100;
  const rows = (track.paths[String(STORY_H)]?.rw ?? []).filter(
    (r) => (r.split === "validation" || r.split === "holdout") && r.actual !== null && r.q10 !== null && r.q90 !== null,
  );
  const contest = CONTEST_MODELS.map((model) => {
    const m = track.metrics.find((r) => r.subset === "all" && r.split === "validation" && r.model === model && r.h === STORY_H);
    return m && m.mae_usd_t !== null && m.mase !== null ? { model, n: m.n, mae: m.mae_usd_t, mase: m.mase } : null;
  })
    .filter((r): r is ContestRow => r !== null)
    .sort((a, b) => a.mae - b.mae);
  const tests = track.tests.filter((r) => r.h === STORY_H);
  const sh = outlook.stress.horizons.find((x) => x.h === STORY_H);
  const mv = wasde.reaction.release_move;
  return {
    history: { t: outlook.history.map((p) => toDay(p.date)), c: outlook.history.map((p) => p.c_bu) },
    backtest: {
      t: rows.map((r) => toDay(r.target_date)),
      lo: rows.map((r) => r1(r.q10! * k)),
      hi: rows.map((r) => r1(r.q90! * k)),
      a: rows.map((r) => r1(r.actual! * k)),
      split: rows.map((r) => (r.split === "validation" ? "v" : "h")).join(""),
    },
    contest,
    holmNone: tests.length > 0 && tests.every((r) => r.cw_p_holm !== null && r.cw_p_holm >= meta.champion_alpha),
    stress: (sh?.episodes ?? []).map((e) => ({ id: e.id, name: e.name, start: e.start, pct: e.pct })),
    move: mv ? { typical_usd_t: mv.typical_usd_t, one_in_ten_usd_t: mv.one_in_ten_usd_t, n: mv.n } : null,
  };
}

/** The outlook without its price history and stress block (the story carries its own slim copies). */
export type OutlookCore = Pick<Outlook, "as_of_close" | "last" | "horizons">;
export const outlookCore = (o: Outlook): OutlookCore => ({ as_of_close: o.as_of_close, last: o.last, horizons: o.horizons });

// ---------------------------------------------------------------------------------------------
// Pure helpers the story components share (unit tested in story.test.ts).

/** "8 in 10": a share as a count out of `of` (nominal 0.8 -> 8; a 0.708 hit rate -> 7). */
export const inTen = (share: number, of = 10) => Math.round(share * of);

/** Rows scored inside their range, by split ("v" validation, "h" holdout). */
export function heldCount(b: StoryView["backtest"], split: "v" | "h"): { held: number; n: number } {
  let held = 0;
  let n = 0;
  for (let i = 0; i < b.t.length; i++) {
    if (b.split[i] !== split) continue;
    n += 1;
    if (b.a[i] >= b.lo[i] && b.a[i] <= b.hi[i]) held += 1;
  }
  return { held, n };
}

/** A 1-2-2.5-5 step giving about `target` ticks over `span`. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

/** Tick values on multiples of a nice step, inside [lo, hi]. */
export function ticks(lo: number, hi: number, target = 5): number[] {
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** A linear scale from a domain to a range. */
export const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** The domain shared by the range ladder: every limit and today's price, padded on both sides. */
export function ladderDomain(values: number[], pad = 0.16): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * pad, hi + span * pad];
}

/** Calendar month (1-12) of an ISO date. */
export const monthOf = (iso: string) => Number(iso.slice(5, 7));

/** Day of the week of an ISO date (0 = Sunday), in UTC. */
export const weekdayOf = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay();

/**
 * Which tail a flagged range misses on, from the published validation miss shares: "up" when the
 * price ended above it more often than below, "down" for the reverse, null when they are equal.
 */
export function missSide(h: Pick<Horizon, "coverage">): "up" | "down" | null {
  const v = h.coverage.validation;
  if (!v || v.miss_lo80 == null || v.miss_hi80 == null || v.miss_lo80 === v.miss_hi80) return null;
  return v.miss_hi80 > v.miss_lo80 ? "up" : "down";
}
