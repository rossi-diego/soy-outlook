// Decision panel arithmetic (P18), pre-registered in docs/PLAN.md (2026-11-08).
// Illustrative and range-based, not VaR: CBOT only, premium and BRL held fixed, so the hedge is
// futures at today's close and the basis stays unhedged. No target-price probability.

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

/**
 * Parse typed tonnes ("5000", "5,000", "5 000"; pt-BR "5.000"); rejects anything not in
 * 1..TONNES_MAX. The thousands separator follows the locale, the value never does.
 */
export function parseTonnes(text: string, loc: Locale = "en"): { ok: true; value: number } | { ok: false; error: string } {
  const pt = loc === "pt-BR";
  const t = pt ? text.trim().replace(/[\s._]/g, "").replace(",", ".") : text.trim().replace(/[\s,_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: pt ? "Digite um número inteiro de toneladas." : "Enter a whole number of tonnes." };
  const v = Math.round(Number(t));
  if (v < 1 || v > TONNES_MAX)
    return {
      ok: false,
      error: pt
        ? `Use entre 1 e ${TONNES_MAX.toLocaleString("pt-BR")} toneladas.`
        : `Use between 1 and ${TONNES_MAX.toLocaleString("en-US")} tonnes.`,
    };
  return { ok: true, value: v };
}
