import { describe, expect, it } from "vitest";

import { businessDaysBetween, staleReasons } from "./freshness";
import type { Freshness } from "./types";

// Fixed dates, so these cases hold whatever data is committed under public/data.
const base = (over: Partial<Freshness> = {}): Freshness => ({
  as_of_close: "2026-11-10", // a Tuesday that is also a WASDE release day
  generated_at: "2026-11-11T02:00:00+00:00",
  mode: "live",
  stale_after_bdays: 3,
  bdays_close_to_generated: 0,
  next_wasde: "2026-12-10",
  sources: {},
  degraded: false,
  degraded_sources: [],
  ...over,
});
const ids = (f: Freshness, now: string) => staleReasons(f, new Date(now)).map((r) => r.id);

describe("businessDaysBetween", () => {
  it("counts weekdays after the start, up to and including the end", () => {
    expect(businessDaysBetween("2026-11-10", "2026-11-10")).toBe(0);
    expect(businessDaysBetween("2026-11-10", "2026-11-13")).toBe(3);
    expect(businessDaysBetween("2026-11-10", "2026-11-16")).toBe(4); // skips the weekend
    expect(businessDaysBetween("2026-11-16", "2026-11-10")).toBe(0);
  });
});

describe("staleReasons: close age", () => {
  it("is quiet at exactly stale_after_bdays", () => {
    expect(ids(base(), "2026-11-13T21:00:00Z")).toEqual([]);
  });

  it("flags the close one business day later, in the Chicago calendar", () => {
    expect(ids(base(), "2026-11-16T21:00:00Z")).toEqual(["close"]);
    // 02:00Z on the 17th is still the 16th in Chicago.
    expect(staleReasons(base(), new Date("2026-11-17T02:00:00Z"))[0].text).toContain("4 business days ago");
  });
});

describe("staleReasons: next WASDE", () => {
  const f = base({ as_of_close: "2026-12-08" });

  it("is quiet when the next WASDE is weeks ahead of an old close", () => {
    expect(ids(base(), "2026-11-16T21:00:00Z")).not.toContain("wasde");
  });

  it("switches on at 17:00Z on the release day, not a second before", () => {
    expect(ids(f, "2026-12-10T16:59:59Z")).toEqual([]);
    expect(ids(f, "2026-12-10T17:00:00Z")).toEqual(["wasde"]);
  });

  it("never fires without a published next date", () => {
    expect(ids(base({ next_wasde: null, as_of_close: "2026-12-08" }), "2027-01-20T18:00:00Z")).not.toContain("wasde");
  });
});

describe("staleReasons: degraded sources", () => {
  it("names the cached sources, on its own and alongside the others", () => {
    const f = base({ degraded: true, degraded_sources: ["ptax"] });
    const fresh = staleReasons(f, new Date("2026-11-11T21:00:00Z"));
    expect(fresh.map((r) => r.id)).toEqual(["cache"]);
    expect(fresh[0].text).toContain("ptax");
    expect(ids(f, "2026-11-16T21:00:00Z")).toEqual(["close", "cache"]);
  });

  it("writes every reason in pt-BR too", () => {
    const f = base({ as_of_close: "2026-12-01", degraded: true, degraded_sources: ["ptax"] });
    const pt = staleReasons(f, new Date("2026-12-10T18:00:00Z"), "pt-BR");
    expect(pt.map((r) => r.id)).toEqual(["close", "wasde", "cache"]);
    expect(pt[0].text).toContain("dias úteis");
  });
});
