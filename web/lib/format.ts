// Units: every price is stored in US cents per bushel (the CBOT quote) and converted here.
// Every formatter takes an optional locale (lib/i18n.ts); English is the default, so server code
// and the copy-vs-data tests keep their exact strings. pt-BR uses Intl number and date formatting
// ("R$ 132,45/sc", "6 nov 2026"); the numbers themselves never change with the locale.
import type { Locale } from "./i18n";

export type Unit = "c_bu" | "usd_t" | "brl_sack";

const INTL: Record<Locale, string> = { en: "en-US", "pt-BR": "pt-BR" };

export const UNIT_LABEL: Record<Unit, string> = {
  c_bu: "US¢/bu",
  usd_t: "USD/t",
  brl_sack: "R$/sack",
};

const UNIT_LABEL_PT: Record<Unit, string> = {
  c_bu: "US¢/bu",
  usd_t: "USD/t",
  brl_sack: "R$/sc",
};

export const unitLabel = (u: Unit, loc: Locale = "en") => (loc === "pt-BR" ? UNIT_LABEL_PT : UNIT_LABEL)[u];

export const UNIT_LONG: Record<Unit, string> = {
  c_bu: "CBOT soybeans, US cents per bushel",
  usd_t: "Paranaguá FOB, US dollars per tonne",
  brl_sack: "Paranaguá FOB, reais per 60 kg sack",
};

const UNIT_LONG_PT: Record<Unit, string> = {
  c_bu: "Soja na CBOT, centavos de dólar por bushel",
  usd_t: "FOB Paranaguá, dólares por tonelada",
  brl_sack: "FOB Paranaguá, reais por saca de 60 kg",
};

// With no premium entered, USD/t and R$/sack are the CBOT price alone, converted (no FOB).
const UNIT_LONG_CBOT: Record<Unit, string> = {
  c_bu: UNIT_LONG.c_bu,
  usd_t: "CBOT soybeans in US dollars per tonne, CBOT only, excl. premium",
  brl_sack: "CBOT soybeans in reais per 60 kg sack, CBOT only, excl. premium",
};

const UNIT_LONG_CBOT_PT: Record<Unit, string> = {
  c_bu: UNIT_LONG_PT.c_bu,
  usd_t: "Soja na CBOT em dólares por tonelada, só CBOT, sem prêmio",
  brl_sack: "Soja na CBOT em reais por saca de 60 kg, só CBOT, sem prêmio",
};

/** Long unit name; `fob` = a premium was entered, so USD/t and R$/sack are Paranaguá FOB. */
export const unitLong = (u: Unit, loc: Locale = "en", fob = true) =>
  (fob ? (loc === "pt-BR" ? UNIT_LONG_PT : UNIT_LONG) : loc === "pt-BR" ? UNIT_LONG_CBOT_PT : UNIT_LONG_CBOT)[u];

/**
 * premium: ¢/bu added to CBOT for the FOB units, typed by the user (0 = CBOT only: no premium
 * data ships with the site). basis: an optional, user-supplied
 * port-to-interior discount in R$/sack (P20), subtracted only from the R$/sack value; 0 = port FOB.
 */
export type Assumptions = { premium: number; fx: number; buPerT: number; sackKg: number; basis?: number };

/** CBOT (¢/bu) -> chosen unit. FOB units add the premium (¢/bu) before converting. */
export function convert(cbot: number, unit: Unit, a: Assumptions): number {
  if (unit === "c_bu") return cbot;
  const usdT = ((cbot + a.premium) / 100) * a.buPerT;
  if (unit === "usd_t") return usdT;
  return (usdT * a.sackKg * a.fx) / 1000 - (a.basis ?? 0);
}

export function decimalsFor(unit: Unit): number {
  return unit === "brl_sack" ? 2 : 0;
}

export function num(v: number | null | undefined, d = 0, loc: Locale = "en"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(INTL[loc], { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function money(v: number | null | undefined, unit: Unit, loc: Locale = "en"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const d = decimalsFor(unit);
  if (unit === "usd_t") return loc === "pt-BR" ? `US$ ${num(v, d, loc)}/t` : `$${num(v, d, loc)}/t`;
  if (unit === "brl_sack") return `R$ ${num(v, d, loc)}/sc`;
  return `${num(v, d, loc)}¢/bu`;
}

export function signed(v: number | null | undefined, d = 0, loc: Locale = "en"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v) < 0.5 * 10 ** -d) return loc === "pt-BR" ? "estável" : "unch.";
  const s = Math.abs(v).toLocaleString(INTL[loc], { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v > 0 ? "+" : "−"}${s}`;
}

export function pct(v: number | null | undefined, d = 0, loc: Locale = "en"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (loc === "en") return `${(v * 100).toFixed(d)}%`;
  return `${num(v * 100, d, loc)}%`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Short month name, 1-based. */
export const monthAbbr = (m: number, loc: Locale = "en") => (loc === "pt-BR" ? MONTHS_PT : MONTHS)[m - 1];

export function dateLabel(iso: string, style: "long" | "short" = "short", loc: Locale = "en"): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  if (loc === "pt-BR" && style === "short") {
    // "6 nov 2026": the compact form Brazilian market reports use (Intl would say "6 de nov. de 2026").
    return `${d.getUTCDate()} ${MONTHS_PT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return d.toLocaleDateString(INTL[loc], {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthLabel(m: string, loc: Locale = "en"): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(INTL[loc], { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Month name alone ("October", "outubro"). */
export function monthName(m: string, loc: Locale = "en"): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(INTL[loc], { month: "long", timeZone: "UTC" });
}

export const horizonLabel = (h: number, loc: Locale = "en") =>
  loc === "pt-BR" ? (h === 1 ? "1 mês" : `${h} meses`) : h === 1 ? "1 month" : `${h} months`;

/** Premium in US cents per bushel -> USD per tonne (no CBOT leg). */
export const premiumUsdT = (cBu: number, buPerT: number) => (cBu / 100) * buPerT;

type CoverageLike = {
  nominal: { "80": number; "95": number };
  validation: { years: string; cover80: number; cover95: number } | null;
  holdout: { years: string; cover80: number; cover95: number } | null;
};

/**
 * Measured hit rate next to the nominal level, from the published coverage block, e.g.
 * "held 71% in 2016-23, 85% in 2024+". The e2e contract test rebuilds this string from the JSON.
 */
export function heldText(cov: CoverageLike, level: "80" | "95", loc: Locale = "en"): string {
  const key = level === "80" ? "cover80" : "cover95";
  const pt = loc === "pt-BR";
  const parts = [cov.validation, cov.holdout]
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => `${pct(s[key], 0, loc)} ${pt ? "em" : "in"} ${s.years}`);
  if (!parts.length) return pt ? "taxa de acerto ainda indisponível" : "hit rate not available yet";
  return `${pt ? "acertou" : "held"} ${parts.join(", ")}`;
}

/** "80% range (held 71% in 2016-23, 85% in 2024+)": the nominal level stays visible. */
export function rangeLabel(cov: CoverageLike, level: "80" | "95", loc: Locale = "en"): string {
  const n = pct(cov.nominal[level], 0, loc);
  return loc === "pt-BR" ? `faixa de ${n} (${heldText(cov, level, loc)})` : `${n} range (${heldText(cov, level, loc)})`;
}

type CiSplit = {
  ci80: [number | null, number | null];
  ci95: [number | null, number | null];
  n_eff80: number | null;
  n_eff95: number | null;
} | null;

/**
 * Plain-words uncertainty of a validation hit rate (P4), e.g. "likely 54–87%, about 32
 * independent outcomes": the moving-block bootstrap 95% CI and the overlap-aware n_eff.
 * The e2e contract test rebuilds this string from the JSON.
 */
export function ciText(split: CiSplit, level: "80" | "95", withCount = true, loc: Locale = "en"): string | null {
  if (!split) return null;
  const [lo, hi] = level === "80" ? split.ci80 : split.ci95;
  const n = level === "80" ? split.n_eff80 : split.n_eff95;
  if (lo === null || hi === null) return null;
  const pt = loc === "pt-BR";
  const count =
    n === null || !withCount ? "" : pt ? `, cerca de ${Math.round(n)} resultados independentes` : `, about ${Math.round(n)} independent outcomes`;
  return `${pt ? "provavelmente" : "likely"} ${pct(lo, 0, loc)}–${pct(hi, 0, loc)}${count}`;
}

export const FX_MIN = 3;
export const FX_MAX = 9;

/**
 * Parse a typed BRL/USD rate ("5.50", "5,50", " 5.5 "). Accepts a comma as the decimal mark,
 * since R$ users type one; rejects anything outside FX_MIN..FX_MAX with an inline message.
 */
export function parseFx(text: string, loc: Locale = "en"): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  const pt = loc === "pt-BR";
  if (!/^\d+(\.\d+)?$/.test(t))
    return { ok: false, error: pt ? `Digite um número entre ${FX_MIN} e ${FX_MAX}.` : `Enter a number between ${FX_MIN} and ${FX_MAX}.` };
  const v = Number(t);
  if (v < FX_MIN || v > FX_MAX)
    return {
      ok: false,
      error: pt ? `Use uma taxa entre ${FX_MIN} e ${FX_MAX} reais por dólar.` : `Use a rate between ${FX_MIN} and ${FX_MAX} BRL per USD.`,
    };
  return { ok: true, value: Math.round(v * 10000) / 10000 };
}

export const BASIS_MAX = 100;

/**
 * Parse the optional port-to-interior discount (P20), in R$/sack. Empty means 0 (port FOB).
 * User-supplied only: there are no regional defaults without a sourced dataset.
 */
export function parseBasis(text: string, loc: Locale = "en"): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  if (t === "") return { ok: true, value: 0 };
  const pt = loc === "pt-BR";
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) > BASIS_MAX)
    return {
      ok: false,
      error: pt ? `Digite um desconto entre 0 e ${BASIS_MAX} R$/sc.` : `Enter a discount between 0 and ${BASIS_MAX} R$/sack.`,
    };
  return { ok: true, value: Math.round(Number(t) * 100) / 100 };
}

type MoveSplit = {
  years: string;
  n: number;
  hit50: number | null;
  ci50: [number, number] | null;
  hit90: number | null;
  ci90: [number, number] | null;
};

/**
 * Out-of-sample hit rate of one release-day move band (P14), e.g. "50% of 86 reports in
 * 2016-2023 (likely 40%–60%)". The e2e contract test rebuilds this string from the JSON.
 */
export function moveHitText(s: MoveSplit, level: "50" | "90", loc: Locale = "en"): string {
  const hit = level === "50" ? s.hit50 : s.hit90;
  const ci = level === "50" ? s.ci50 : s.ci90;
  const pt = loc === "pt-BR";
  if (hit === null || s.n === 0) return pt ? `ainda sem relatórios em ${s.years}` : `no reports yet in ${s.years}`;
  const range = ci ? ` (${pt ? "provavelmente" : "likely"} ${pct(ci[0], 0, loc)}–${pct(ci[1], 0, loc)})` : "";
  return pt ? `${pct(hit, 0, loc)} de ${s.n} relatórios em ${s.years}${range}` : `${pct(hit, 0, loc)} of ${s.n} reports in ${s.years}${range}`;
}

/** Signed whole number with a true minus ("+79", "−12", "0"), locale-aware grouping. */
export const signed0 = (v: number, loc: Locale = "en") =>
  v > 0 ? `+${num(v, 0, loc)}` : v < 0 ? `−${num(Math.abs(v), 0, loc)}` : "0";

/** Every formatter bound to one locale: `const f = fmt(loc); f.num(1189)`. */
export function fmt(loc: Locale) {
  return {
    loc,
    num: (v: number | null | undefined, d = 0) => num(v, d, loc),
    money: (v: number | null | undefined, unit: Unit) => money(v, unit, loc),
    signed: (v: number | null | undefined, d = 0) => signed(v, d, loc),
    signed0: (v: number) => signed0(v, loc),
    pct: (v: number | null | undefined, d = 0) => pct(v, d, loc),
    date: (iso: string, style: "long" | "short" = "short") => dateLabel(iso, style, loc),
    month: (m: string) => monthLabel(m, loc),
    monthName: (m: string) => monthName(m, loc),
    monthAbbr: (m: number) => monthAbbr(m, loc),
    horizon: (h: number) => horizonLabel(h, loc),
    unit: (u: Unit) => unitLabel(u, loc),
    unitLong: (u: Unit, fob = true) => unitLong(u, loc, fob),
    held: (cov: CoverageLike, level: "80" | "95") => heldText(cov, level, loc),
    range: (cov: CoverageLike, level: "80" | "95") => rangeLabel(cov, level, loc),
    ci: (split: CiSplit, level: "80" | "95", withCount = true) => ciText(split, level, withCount, loc),
    moveHit: (s: MoveSplit, level: "50" | "90") => moveHitText(s, level, loc),
  };
}

export type Fmt = ReturnType<typeof fmt>;
