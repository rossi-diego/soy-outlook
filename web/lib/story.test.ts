import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { storyCopy } from "./i18n";
import { buildStoryView, heldCount, inTen, ladderDomain, missSide, monthOf, niceStep, outlookCore, ticks, weekdayOf } from "./story";
import type { Meta, Outlook, TrackRecord, Wasde } from "./types";

const read = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", f), "utf-8")) as T;
const meta = read<Meta>("meta.json");
const outlook = read<Outlook>("outlook.json");
const track = read<TrackRecord>("track_record.json");
const wasde = read<Wasde>("wasde.json");

describe("story view model (published data only)", () => {
  const v = buildStoryView(outlook, track, wasde, meta);

  it("keeps every weekly close and only scored validation/holdout 3-month ranges", () => {
    expect(v.history.t.length).toBe(outlook.history.length);
    const scored = track.paths["3"].rw.filter((r) => (r.split === "validation" || r.split === "holdout") && r.actual !== null);
    expect(v.backtest.t.length).toBe(scored.length);
    expect(v.backtest.split).toMatch(/^[vh]+$/);
  });

  it("counts the held ranges in line with the published 80% hit rates", () => {
    const h3 = outlook.horizons.find((h) => h.h === 3)!;
    const val = heldCount(v.backtest, "v");
    const hold = heldCount(v.backtest, "h");
    expect(val.n).toBe(h3.coverage.validation!.n);
    // Rounding the limits to 0.1 USD/t can move a boundary case; allow one either way.
    expect(Math.abs(val.held - Math.round(h3.coverage.validation!.cover80 * val.n))).toBeLessThanOrEqual(1);
    expect(hold.n).toBe(h3.coverage.holdout!.n);
    expect(Math.abs(hold.held - Math.round(h3.coverage.holdout!.cover80 * hold.n))).toBeLessThanOrEqual(1);
  });

  it("reads the contest from the published validation metrics, lowest error first", () => {
    expect(v.contest.map((r) => r.model).sort()).toEqual(["arima", "drift", "ridge", "rw"]);
    for (let i = 1; i < v.contest.length; i++) expect(v.contest[i].mae).toBeGreaterThanOrEqual(v.contest[i - 1].mae);
    const rw = track.metrics.find((r) => r.subset === "all" && r.split === "validation" && r.model === "rw" && r.h === 3)!;
    expect(v.contest.find((r) => r.model === "rw")!.mae).toBe(rw.mae_usd_t);
  });

  it("takes the stress episodes and the release-day band as published", () => {
    const sh = outlook.stress.horizons.find((h) => h.h === 3)!;
    expect(v.stress.map((e) => e.name)).toEqual(sh.episodes.map((e) => e.name));
    expect(v.move?.typical_usd_t).toBe(wasde.reaction.release_move.typical_usd_t);
  });

  it("is compact: the client copy carries no full outlook history or paths", () => {
    expect(JSON.stringify(v).length).toBeLessThan(20_000);
    expect(Object.keys(outlookCore(outlook)).sort()).toEqual(["as_of_close", "horizons", "last"]);
  });
});

describe("story helpers", () => {
  it("words shares as counts", () => {
    expect(inTen(0.8)).toBe(8);
    expect(inTen(0.708)).toBe(7);
    expect(inTen(0.95, 20)).toBe(19);
  });

  it("builds nice ticks inside the domain", () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(ticks(372, 532, 5)).toEqual([375, 400, 425, 450, 475, 500, 525]);
    const [lo, hi] = ladderDomain([400, 500]);
    expect(lo).toBeLessThan(400);
    expect(hi).toBeGreaterThan(500);
  });

  it("reads months, weekdays and the side a range misses on", () => {
    expect(monthOf("2027-05-06")).toBe(5);
    expect(weekdayOf("2026-11-10")).toBe(2);
    const h6 = outlook.horizons.find((h) => h.h === 6)!;
    const v = h6.coverage.validation!;
    expect(missSide(h6)).toBe(v.miss_hi80! > v.miss_lo80! ? "up" : "down");
  });

  it("has the same copy keys in both languages", () => {
    expect(Object.keys(storyCopy("pt-BR")).sort()).toEqual(Object.keys(storyCopy("en")).sort());
    expect(storyCopy("pt-BR").h1Accent("maio")).toBe("até maio?");
    expect(storyCopy("en").heldFlag(7, 8)).toBe("⚠ held 7 in 10, not 8");
  });
});
