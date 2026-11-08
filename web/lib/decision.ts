// Decision panel arithmetic (P18), pre-registered in docs/PLAN.md (2026-11-08).
// Illustrative and range-based, not VaR: CBOT only (no premium), BRL held fixed, so the hedge is
// futures at today's close and the basis stays unhedged. No target-price probability: the target
// readout (unit B, pre-registered the same day) is a position within the tested range only.

import type { Locale } from "./i18n";

export type Side = "producer" | "buyer";
export type Currency = "usd" | "brl";

export type DecisionInputs = {
  side: Side;
  tonnes: number;
  /** Share of the tonnes hedged at today's CBOT close, 0..1. */
  hedge: number;
  currency: Currency;
  fx: number;
  buPerT: number;
};

type HorizonLike = { q025: number; q100: number; q900: number; q975: number; grid: { levels: number[]; c_bu: number[] } };

export const TONNES_MAX = 10_000_000;

/** Gain (+) or loss (−) vs selling (producer) or buying (buyer) today, at CBOT price p (¢/bu). */
export function pnlVsToday(p: number, p0: number, x: DecisionInputs): number {
  const move = x.side === "producer" ? p - p0 : p0 - p;
  const perTonneUsd = (move / 100) * x.buPerT;
  const open = x.tonnes * (1 - x.hedge);
  return perTonneUsd * open * (x.currency === "brl" ? x.fx : 1);
}

/** The adverse levels: low quantiles hurt a producer, high quantiles hurt a buyer. */
export function adverse(h: HorizonLike, side: Side): { oneInTen: number; oneInForty: number } {
  return side === "producer" ? { oneInTen: h.q100, oneInForty: h.q025 } : { oneInTen: h.q900, oneInForty: h.q975 };
}

/** P&L vs today at every grid level (5% to 95%), sorted from worst to best for this side. */
export function profile(h: HorizonLike, p0: number, x: DecisionInputs): { level: number; pnl: number }[] {
  const rows = h.grid.levels.map((level, i) => ({ level, pnl: pnlVsToday(h.grid.c_bu[i], p0, x) }));
  return x.side === "producer" ? rows : rows.reverse();
}

/** "US$ 1.2M" style, signed with a true minus; pt-BR: "US$ 1,2 mi", "R$ 68 mil". */
export function moneyAmount(v: number, currency: Currency, loc: Locale = "en"): string {
  const sym = currency === "usd" ? "US$" : "R$";
  const a = Math.abs(v);
  const intl = loc === "pt-BR" ? "pt-BR" : "en-US";
  const pt = loc === "pt-BR";
  const body =
    a >= 1e6
      ? `${(a / 1e6).toLocaleString(intl, { maximumFractionDigits: a >= 1e8 ? 0 : 2 })}${pt ? " mi" : "M"}`
      : a >= 1e4
        ? `${(a / 1e3).toLocaleString(intl, { maximumFractionDigits: 0 })}${pt ? " mil" : "k"}`
        : a.toLocaleString(intl, { maximumFractionDigits: 0 });
  if (Math.round(a) === 0) return `${sym} 0`;
  return `${v < 0 ? "−" : "+"}${sym} ${body}`;
}

export type VolumeUnit = "t" | "sc";

/** Physical volume in tonnes from a typed amount in tonnes or 60 kg sacks. */
export const toTonnes = (v: number, unit: VolumeUnit, sackKg: number) => (unit === "t" ? v : (v * sackKg) / 1000);

/**
 * Parse a typed volume ("5000", "5,000", "5 000"; pt-BR "5.000") in tonnes or sacks; rejects
 * anything not in 1..TONNES_MAX. The thousands separator follows the locale, the value never does.
 */
export function parseVolume(
  text: string,
  loc: Locale = "en",
  unit: VolumeUnit = "t",
): { ok: true; value: number } | { ok: false; error: string } {
  const pt = loc === "pt-BR";
  const t = pt ? text.trim().replace(/[\s._]/g, "").replace(",", ".") : text.trim().replace(/[\s,_]/g, "");
  const word = unit === "t" ? (pt ? "toneladas" : "tonnes") : pt ? "sacas" : "sacks";
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: pt ? `Digite um número inteiro de ${word}.` : `Enter a whole number of ${word}.` };
  const v = Math.round(Number(t));
  if (v < 1 || v > TONNES_MAX)
    return {
      ok: false,
      error: pt
        ? `Use entre 1 e ${TONNES_MAX.toLocaleString("pt-BR")} ${word}.`
        : `Use between 1 and ${TONNES_MAX.toLocaleString("en-US")} ${word}.`,
    };
  return { ok: true, value: v };
}

/** Tonnes only (kept for callers and tests that predate the sack unit). */
export const parseTonnes = (text: string, loc: Locale = "en") => parseVolume(text, loc, "t");

type TailCoverage = { tail_warn_lo80: boolean; tail_warn_hi80: boolean; validation: { miss_lo80?: number | null; miss_hi80?: number | null } | null };

/**
 * The 80% tail that hurts this side (unit B display rule, config.TAIL_NOMINAL_80): the lower
 * tail for a producer, the upper tail for a buyer, with its validation miss rate and the
 * published flag (miss rate more than 5 points above the 10% one-tail nominal).
 */
export function adverseTail(cov: TailCoverage, side: Side): { miss: number | null; warn: boolean } {
  return side === "producer"
    ? { miss: cov.validation?.miss_lo80 ?? null, warn: cov.tail_warn_lo80 }
    : { miss: cov.validation?.miss_hi80 ?? null, warn: cov.tail_warn_hi80 };
}

export type TargetPosition = { kind: "below"; level: number } | { kind: "above"; level: number } | { kind: "between"; lo: number; hi: number };

/**
 * Where a target sits among the readout levels of the tested range (config.TARGET_READOUT_LEVELS):
 * below the lowest, above the highest, or between two neighbours. `value(level)` is the range's
 * price at that grid level in the target's unit. A position within the range, never a probability.
 */
export function targetPosition(target: number, readout: number[], value: (level: number) => number | null): TargetPosition | null {
  const pts = readout
    .map((level) => ({ level, v: value(level) }))
    .filter((p): p is { level: number; v: number } => p.v !== null)
    .sort((a, b) => a.level - b.level);
  if (pts.length < 2 || !Number.isFinite(target)) return null;
  if (target < pts[0].v) return { kind: "below", level: pts[0].level };
  if (target > pts[pts.length - 1].v) return { kind: "above", level: pts[pts.length - 1].level };
  for (let i = 0; i < pts.length - 1; i++) if (target <= pts[i + 1].v) return { kind: "between", lo: pts[i].level, hi: pts[i + 1].level };
  return { kind: "above", level: pts[pts.length - 1].level };
}

/** The grid price at one level (levels are 5% steps, matched with a float tolerance). */
export function gridAt(grid: { levels: number[]; c_bu: number[] }, level: number): number | null {
  const i = grid.levels.findIndex((l) => Math.abs(l - level) < 1e-6);
  return i < 0 ? null : grid.c_bu[i];
}

/** Parse a typed target price ("1,180", "132.5"; pt-BR "1.180", "132,50"); empty = no target. */
export function parsePrice(text: string, loc: Locale = "en"): { ok: true; value: number | null } | { ok: false; error: string } {
  const pt = loc === "pt-BR";
  const raw = text.trim().replace(/\s/g, "");
  if (raw === "") return { ok: true, value: null };
  // A separator is a thousands mark only in groups of three ("1.180", "1,180"); otherwise it is
  // the decimal mark, so "132.50" typed under pt-BR is still 132.5, not 13,250.
  const [group, dec] = pt ? [".", ","] : [",", "."];
  const grouped = new RegExp(`^\\d{1,3}(\\${group}\\d{3})+(\\${dec}\\d+)?$`).test(raw);
  const t = grouped ? raw.split(group).join("").replace(dec, ".") : raw.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) <= 0)
    return { ok: false, error: pt ? "Digite um preço positivo, ou deixe vazio." : "Enter a positive price, or leave it empty." };
  return { ok: true, value: Number(t) };
}
