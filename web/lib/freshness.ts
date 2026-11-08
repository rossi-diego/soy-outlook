// Client-side staleness rules for the banner. Pure functions, so the e2e tests can pin the clock.
// The thresholds come from meta.json (freshness.stale_after_bdays), never from this file.

import { dateLabel } from "./format";
import type { Freshness } from "./types";

const CBOT_TZ = "America/Chicago";
// WASDE is released at 12:00 US Eastern; 17:00 UTC is at or after that in both seasons.
const WASDE_RELEASE_UTC = "T17:00:00Z";

/** The calendar date in Chicago (where the CBOT close is dated), as YYYY-MM-DD. */
export function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CBOT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Weekdays after `start` up to and including `end` (0 when end <= start). Mirrors freshness.py. */
export function businessDaysBetween(start: string, end: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

export type StaleReason = { id: "close" | "wasde" | "cache"; text: string };

export function staleReasons(f: Freshness, now: Date): StaleReason[] {
  const out: StaleReason[] = [];
  const age = businessDaysBetween(f.as_of_close, chicagoDate(now));
  if (age > f.stale_after_bdays) {
    out.push({
      id: "close",
      text: `The latest CBOT close here is ${dateLabel(f.as_of_close)}, ${age} business days ago (refresh expected within ${f.stale_after_bdays}).`,
    });
  }
  if (f.next_wasde && now.getTime() >= Date.parse(f.next_wasde + WASDE_RELEASE_UTC)) {
    out.push({
      id: "wasde",
      text: `The ${dateLabel(f.next_wasde)} WASDE has been released since this outlook was built; it is not in these numbers yet.`,
    });
  }
  if (f.degraded) {
    out.push({
      id: "cache",
      text: `The last refresh could not download ${f.degraded_sources.join(", ")} and used cached data.`,
    });
  }
  return out;
}
