import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildTrackView, isoDay, maeVsNoChange, PATH_MODELS, toDay } from "./trackView";
import type { Meta, TrackRecord } from "./types";

const DATA = path.join(__dirname, "..", "public", "data");
const track = JSON.parse(fs.readFileSync(path.join(DATA, "track_record.json"), "utf-8")) as TrackRecord;
const meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf-8")) as Meta;

describe("buildTrackView", () => {
  const view = buildTrackView(track, meta.consts.bu_per_t);

  it("keeps only the path models and horizons the page shows, in USD/t", () => {
    expect(Object.keys(view.paths)).toEqual(["1", "3", "6"]);
    for (const h of ["1", "3", "6"]) {
      const col = view.paths[h];
      expect(Object.keys(col.models)).toEqual([...PATH_MODELS]);
      const n = col.t.length;
      for (const m of PATH_MODELS) expect(col.models[m].f).toHaveLength(n);
      expect([...col.t].sort((x, y) => x - y)).toEqual(col.t);
      expect(col.split).toHaveLength(n);
      expect(col.roll).toHaveLength(n);
      // spot-check rows against the source, converted and rounded to 0.1 USD/t
      for (const src of [track.paths[h].rw[0], track.paths[h].rw.at(-1)!]) {
        const i = col.t.indexOf(toDay(src.target_date));
        expect(isoDay(col.t[i])).toBe(src.target_date);
        expect(col.models.rw.f[i]).toBeCloseTo(((src.forecast ?? 0) * meta.consts.bu_per_t) / 100, 1);
        expect(col.roll[i]).toBe(src.roll_cross ? "1" : "0");
        expect(col.split[i]).toBe(src.split === "validation" ? "v" : "h");
      }
    }
  });

  it("is small enough to embed (well under the 100 KB page budget)", () => {
    expect(JSON.stringify(view).length).toBeLessThan(70_000);
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(track).length / 3);
  });

  it("drops the no-crop-roll subset rows", () => {
    expect(view.metrics.every((r) => "split" in r)).toBe(true);
    expect(view.metrics).toHaveLength(track.metrics.filter((r) => r.subset === "all").length);
  });
});

describe("maeVsNoChange", () => {
  it("turns an MAE ratio and its DM statistic into a % difference with a 95% interval", () => {
    const r = maeVsNoChange(1.04, 2);
    expect(r?.d).toBeCloseTo(4, 10);
    expect(r?.lo).toBeCloseTo(4 - 1.96 * 2, 10);
    expect(r?.hi).toBeCloseTo(4 + 1.96 * 2, 10);
  });
  it("gives no interval when the statistic is missing, zero or of the opposite sign", () => {
    expect(maeVsNoChange(1.04, null)?.lo).toBeNull();
    expect(maeVsNoChange(1.04, 0)?.lo).toBeNull();
    expect(maeVsNoChange(1.04, -1.5)?.lo).toBeNull();
    expect(maeVsNoChange(null, 1)).toBeNull();
  });
});
