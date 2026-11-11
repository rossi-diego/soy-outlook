// How far the live forecast is from the WASDE release-day origins the ranges were tested on.
// Pure functions (no React), so the release-day and singular cases are unit-tested.

import { monthAbbr } from "./format";
import type { Locale } from "./i18n";

/** Headline label: "Issued on the Nov WASDE release day" / "Issued from the Nov WASDE, 3 days after its release". */
export function issuedLabel(days: number, wasdeMonth: string, loc: Locale = "en"): string {
  const pt = loc === "pt-BR";
  const month = monthAbbr(Number(wasdeMonth.slice(5, 7)), loc);
  if (days <= 0) {
    return pt ? `Emitida no dia de divulgação do WASDE de ${month}` : `Issued on the ${month} WASDE release day`;
  }
  const s = days === 1 ? "" : "s";
  return pt
    ? `Emitida a partir do WASDE de ${month}, ${days} dia${s} após a divulgação`
    : `Issued from the ${month} WASDE, ${days} day${s} after its release`;
}

/** Methodology clause after "issued from the latest close,": the gap to the report, `releaseDate` already formatted. */
export function reportGapText(days: number, releaseDate: string, loc: Locale = "en"): string {
  const pt = loc === "pt-BR";
  if (days <= 0) return pt ? `no próprio dia do relatório de ${releaseDate}` : `on the day of the ${releaseDate} report`;
  const s = days === 1 ? "" : "s";
  return pt ? `${days} dia${s} depois do relatório de ${releaseDate}` : `${days} day${s} after the ${releaseDate} report`;
}
