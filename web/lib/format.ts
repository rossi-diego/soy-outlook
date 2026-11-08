// Units: every price is stored in US cents per bushel (the CBOT quote) and converted here.

export type Unit = "c_bu" | "usd_t" | "brl_sack";

export const UNIT_LABEL: Record<Unit, string> = {
  c_bu: "US¢/bu",
  usd_t: "USD/t",
  brl_sack: "R$/sack",
};

export const UNIT_LONG: Record<Unit, string> = {
  c_bu: "CBOT soybeans, US cents per bushel",
  usd_t: "Paranaguá FOB, US dollars per tonne",
  brl_sack: "Paranaguá FOB, reais per 60 kg sack",
};

export type Assumptions = { premium: number; fx: number; buPerT: number; sackKg: number };

/** CBOT (¢/bu) -> chosen unit. FOB units add the premium (¢/bu) before converting. */
export function convert(cbot: number, unit: Unit, a: Assumptions): number {
  if (unit === "c_bu") return cbot;
  const usdT = ((cbot + a.premium) / 100) * a.buPerT;
  if (unit === "usd_t") return usdT;
  return (usdT * a.sackKg * a.fx) / 1000;
}

export function decimalsFor(unit: Unit): number {
  return unit === "brl_sack" ? 2 : unit === "usd_t" ? 0 : 0;
}

export function num(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function money(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const d = decimalsFor(unit);
  if (unit === "usd_t") return `$${num(v, d)}/t`;
  if (unit === "brl_sack") return `R$ ${num(v, d)}/sc`;
  return `${num(v, d)}¢/bu`;
}

export function signed(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v) < 0.5 * 10 ** -d) return "unch.";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v > 0 ? "+" : "−"}${s}`;
}

export function pct(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

export function dateLabel(iso: string, style: "long" | "short" = "short"): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const horizonLabel = (h: number) => (h === 1 ? "1 month" : `${h} months`);

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
export function heldText(cov: CoverageLike, level: "80" | "95"): string {
  const key = level === "80" ? "cover80" : "cover95";
  const parts = [cov.validation, cov.holdout]
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => `${pct(s[key])} in ${s.years}`);
  return parts.length ? `held ${parts.join(", ")}` : "hit rate not available yet";
}

/** "80% range (held 71% in 2016-23, 85% in 2024+)": the nominal level stays visible. */
export function rangeLabel(cov: CoverageLike, level: "80" | "95"): string {
  return `${pct(cov.nominal[level])} range (${heldText(cov, level)})`;
}
