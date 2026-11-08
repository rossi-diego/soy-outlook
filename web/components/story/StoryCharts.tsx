"use client";

// The story's charts: plain SVG drawn at the measured width of their column, so text stays at its
// real size on a 390 px phone instead of being scaled down. They render after mount (the width is
// unknown on the server), inside a box of the final height, which keeps them out of the static
// HTML and its size budget. ECharts is not needed here: these are static pictures with few marks.
import { type ReactNode, useEffect, useRef, useState } from "react";

import { linear, ticks } from "@/lib/story";

/** Width of an element, tracked with a ResizeObserver; null until mounted. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Below this chart width, labels give way to numbered markers and fewer ticks. */
export const NARROW = 560;

/** A chart frame: an image role with a text alternative, holding its height while it waits for a width. */
export function Figure({
  label,
  height,
  testId,
  children,
}: {
  label: string;
  height: (w: number) => number;
  testId?: string;
  children: (w: number, h: number) => ReactNode;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = height(w ?? 1000);
  return (
    <div ref={ref} className="figure" role="img" aria-label={label} style={{ height: h }} data-testid={testId}>
      {w !== null && w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" data-story-chart="ready">
          {children(w, h)}
        </svg>
      )}
    </div>
  );
}

const DAY = 86_400_000;
export const dayOf = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);
const yearStart = (y: number) => dayOf(`${y}-01-01`);
const yearOfDay = (d: number) => new Date(d * DAY).getUTCFullYear();
const pathD = (xs: number[], ys: number[]) => xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join("");

/** Horizontal grid lines with their labels on the left. */
function YGrid({ vals, y, x0, x1, label }: { vals: number[]; y: (v: number) => number; x0: number; x1: number; label: (v: number) => string }) {
  return (
    <g>
      {vals.map((v) => (
        <g key={v}>
          <line className="ax" x1={x0} x2={x1} y1={y(v)} y2={y(v)} />
          <text className="axt" x={x0 - 8} y={y(v) + 4} textAnchor="end">
            {label(v)}
          </text>
        </g>
      ))}
    </g>
  );
}

type Box = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Rough rendered width of a label (Plex Sans, 12 px semibold), slightly generous. */
const textW = (s: string, px = 12) => s.length * px * 0.62;

/** True when the polyline crosses the box (each segment sampled, so steep moves count too). */
function lineHits(px: number[], py: number[], b: Box, pad = 3): boolean {
  const x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  const y0 = b.y0 - pad;
  const y1 = b.y1 + pad;
  for (let i = 1; i < px.length; i++) {
    if (Math.max(px[i - 1], px[i]) < x0 || Math.min(px[i - 1], px[i]) > x1) continue;
    for (let k = 0; k <= 6; k++) {
      const xx = px[i - 1] + ((px[i] - px[i - 1]) * k) / 6;
      const yy = py[i - 1] + ((py[i] - py[i - 1]) * k) / 6;
      if (xx >= x0 && xx <= x1 && yy >= y0 && yy <= y1) return true;
    }
  }
  return false;
}

/** "today $439" next to the last point: the first spot (above-left, below-left, above, below) clear of the line. */
function todaySpot(px: number[], py: number[], x: number, y: number, text: string): { x: number; y: number; anchor: "end" | "middle" } {
  const w = textW(text);
  const cands: { x: number; y: number; anchor: "end" | "middle" }[] = [
    { x: x - 10, y: y - 12, anchor: "end" },
    { x: x - 10, y: y + 22, anchor: "end" },
    { x: x - 10, y: y - 30, anchor: "end" },
    { x: x - 10, y: y + 40, anchor: "end" },
    { x: x - 10, y: y - 52, anchor: "end" },
    { x: x - 10, y: y - 72, anchor: "end" },
    { x: x - 10, y: y + 60, anchor: "end" },
  ];
  for (const c of cands) {
    const box = { x0: c.x - w, x1: c.x, y0: c.y - 12, y1: c.y + 3 };
    if (!lineHits(px, py, box, 1)) return c;
  }
  return cands[0];
}

export type Episode = { n: number; name: string; move: string; day: number };

/**
 * Chapter 1: the full weekly price history in CBOT USD/t, with the pre-registered stress
 * episodes marked where they start. Wide charts label each episode next to the line, placed so no
 * label covers another or the line; narrow ones show numbered markers, listed under the chart.
 */
export function HistoryChart({
  label,
  t,
  v,
  episodes,
  todayText,
  money,
}: {
  label: string;
  t: number[];
  v: number[];
  episodes: Episode[];
  todayText: string;
  money: (v: number) => string;
}) {
  return (
    <Figure label={label} height={(w) => (w < NARROW ? 260 : 360)} testId="history-chart">
      {(W, H) => {
        const narrow = W < NARROW;
        const L = 46;
        const R = 12;
        const T = 16;
        const B = 26;
        const ys = ticks(Math.min(...v), Math.max(...v), narrow ? 4 : 5);
        const step = ys[1] - ys[0];
        const lo = Math.min(ys[0], Math.min(...v) - step * 0.2);
        const hi = Math.max(...v) + step * (narrow ? 0.5 : 1.4);
        const x = linear(t[0], t[t.length - 1], L, W - R);
        const y = linear(lo, hi, H - B, T);
        const px = t.map(x);
        const py = v.map(y);
        const y0 = yearOfDay(t[0]);
        const y1 = yearOfDay(t[t.length - 1]);
        const every = narrow ? 4 : 2;
        const years: number[] = [];
        for (let yr = y0 + 1; yr <= y1; yr++) if ((yr - y0 - 1) % every === 0) years.push(yr);
        // Episode anchors: the first weekly close on or after the episode's start.
        const pts = episodes.map((e) => {
          const i = Math.max(0, t.findIndex((d) => d >= e.day));
          return { ...e, x: px[i], y: py[i] };
        });
        // Greedy label placement: the first offset whose box misses earlier labels and the line.
        const placed: Box[] = [];
        const labels = narrow
          ? []
          : pts.map((p) => {
              const w = Math.max(textW(p.name), textW(p.move, 11)) + 8;
              const offs = [-46, 52, -78, 84, -110, 116, -142];
              // Centred over the point first, then shifted left or right so a steep move clears it.
              const shifts = [0, -w / 2 + 6, w / 2 - 6];
              let best: { ty: number; tx: number; box: Box } | null = null;
              search: for (const dx of shifts)
                for (const dy of offs) {
                  const ty = p.y + dy;
                  const tx = Math.min(W - R - w / 2, Math.max(L + w / 2, p.x + dx));
                  const box = { x0: tx - w / 2, x1: tx + w / 2, y0: ty - 13, y1: ty + 17 };
                  if (box.y0 < 2 || box.y1 > H - B) continue;
                  if (placed.some((q) => overlaps(q, box))) continue;
                  if (!lineHits(px, py, box)) {
                    best = { ty, tx, box };
                    break search;
                  }
                  best ??= { ty, tx, box };
                }
              placed.push(best!.box);
              return { ...p, ty: best!.ty, tx: best!.tx };
            });
        const lastX = px[px.length - 1];
        const lastY = py[py.length - 1];
        return (
          <>
            <YGrid vals={ys.filter((yy) => yy >= lo && yy <= hi)} y={y} x0={L} x1={W - R} label={money} />
            {years.map((yr) => (
              <text key={yr} className="axt" x={x(yearStart(yr))} y={H - 8} textAnchor="middle">
                {yr}
              </text>
            ))}
            <path className="line" d={pathD(px, py)} />
            {labels.map((p) => (
              <g key={p.n}>
                <line className="annl" x1={p.x} x2={p.x} y1={p.ty < p.y ? p.ty + 20 : p.y + 6} y2={p.ty < p.y ? p.y - 6 : p.ty - 15} />
                <text className="ann" x={p.tx} y={p.ty} textAnchor="middle">
                  {p.name}
                </text>
                <text className="anns" x={p.tx} y={p.ty + 15} textAnchor="middle">
                  {p.move}
                </text>
              </g>
            ))}
            {pts.map((p) => (
              <g key={p.n}>
                <circle cx={p.x} cy={p.y} r={narrow ? 8 : 4} fill={narrow ? "var(--page)" : "var(--ink)"} stroke="var(--ink)" strokeWidth={narrow ? 1.25 : 0} />
                {narrow && (
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="ann" style={{ fontSize: 10 }}>
                    {p.n}
                  </text>
                )}
              </g>
            ))}
            <circle cx={lastX} cy={lastY} r={5} fill="var(--field)" />
            {(() => {
              const sp = todaySpot(px, py, lastX, lastY, todayText);
              return (
                <text className="ann" x={sp.x} y={sp.y} textAnchor={sp.anchor}>
                  {todayText}
                </text>
              );
            })()}
          </>
        );
      }}
    </Figure>
  );
}

/**
 * Chapter 3: every scored 3-month 80% range as a bar at its target date, the actual price as a
 * dot (field green inside, amber outside), and the holdout years shaded.
 */
export function BacktestChart({
  label,
  rows,
  examText,
  money,
}: {
  label: string;
  rows: { t: number; lo: number; hi: number; a: number; holdout: boolean }[];
  examText: string;
  money: (v: number) => string;
}) {
  return (
    <Figure label={label} height={(w) => (w < NARROW ? 260 : 330)} testId="backtest-chart">
      {(W, H) => {
        const narrow = W < NARROW;
        const L = 46;
        const R = 12;
        const T = 24;
        const B = 26;
        const all = rows.flatMap((r) => [r.lo, r.hi, r.a]);
        const ys = ticks(Math.min(...all), Math.max(...all), narrow ? 4 : 5);
        const step = ys[1] - ys[0];
        const lo = Math.min(ys[0], Math.min(...all) - step * 0.2);
        const hi = Math.max(...all) + step * 0.2;
        const t0 = rows[0].t - 30;
        const t1 = rows[rows.length - 1].t + 30;
        const x = linear(t0, t1, L, W - R);
        const y = linear(lo, hi, H - B, T);
        const bw = Math.max(1.5, Math.min(5, ((W - L - R) / rows.length) * 0.6));
        const firstHold = rows.find((r) => r.holdout);
        const hx = firstHold ? x(firstHold.t) - bw : null;
        const yearsFrom = yearOfDay(rows[0].t);
        const yearsTo = yearOfDay(rows[rows.length - 1].t);
        const every = narrow ? 4 : 2;
        const years: number[] = [];
        for (let yr = yearsFrom + 1; yr <= yearsTo; yr++) if ((yr - yearsFrom - 1) % every === 0) years.push(yr);
        return (
          <>
            {hx !== null && (
              <>
                <rect className="hold" x={hx} y={T - 18} width={W - R - hx} height={H - B - T + 18} />
                {/* Inside the shaded area when it fits, else right-aligned to the plot edge. */}
                <text
                  className="anns"
                  x={hx + 6 + textW(examText, 11) <= W - R ? hx + 6 : W - R - 4}
                  y={T - 5}
                  textAnchor={hx + 6 + textW(examText, 11) <= W - R ? "start" : "end"}
                >
                  {examText}
                </text>
              </>
            )}
            <YGrid vals={ys.filter((yy) => yy >= lo && yy <= hi)} y={y} x0={L} x1={W - R} label={money} />
            {years.map((yr) => (
              <text key={yr} className="axt" x={x(yearStart(yr))} y={H - 8} textAnchor="middle">
                {yr}
              </text>
            ))}
            {rows.map((r) => (
              <rect key={`b${r.t}`} className="bandr" x={x(r.t) - bw / 2} y={y(r.hi)} width={bw} height={Math.max(1, y(r.lo) - y(r.hi))} rx={bw / 2} opacity={0.85} />
            ))}
            {rows.map((r) => (
              <circle key={`d${r.t}`} cx={x(r.t)} cy={y(r.a)} r={narrow ? 2.2 : 3} className={r.a >= r.lo && r.a <= r.hi ? "in" : "outd"} />
            ))}
          </>
        );
      }}
    </Figure>
  );
}

export type Bar = { h: number; day: number; lo: number; hi: number; lo95: number; hi95: number; tick: string };

/**
 * Chapter 4: the recent price and, at each target date, the 80% range as a thick bar and the 95%
 * range as a thin line, with the dashed "no change" line from today. In the chosen unit.
 */
export function OutlookChart({
  label,
  hist,
  today,
  p0,
  bars,
  noChange,
  todayText,
  money,
  monthTick,
}: {
  label: string;
  hist: { t: number; v: number }[];
  today: number;
  p0: number;
  bars: Bar[];
  noChange: string;
  todayText: string;
  money: (v: number) => string;
  monthTick: (day: number, withYear: boolean) => string;
}) {
  return (
    <Figure label={label} height={(w) => (w < NARROW ? 280 : 380)} testId="outlook-chart">
      {(W, H) => {
        const narrow = W < NARROW;
        // Phones keep 9 months of history so the six months ahead get room of their own.
        const histFrom = today - (narrow ? 274 : 548);
        const shown = hist.filter((p) => p.t >= histFrom);
        const L = 50;
        const R = narrow ? 14 : 84;
        const T = 22;
        const B = 30;
        const last = bars[bars.length - 1];
        const all = [...shown.map((p) => p.v), ...bars.flatMap((b) => [b.lo95, b.hi95]), p0];
        const ys = ticks(Math.min(...all), Math.max(...all), narrow ? 4 : 6);
        const step = ys[1] - ys[0];
        const lo = Math.min(ys[0], Math.min(...all) - step * 0.15);
        const hi = Math.max(...all) + step * 0.15;
        const x = linear(histFrom, last.day + (narrow ? 12 : 20), L, W - R);
        const y = linear(lo, hi, H - B, T);
        const bw = narrow ? 12 : 18;
        // Month ticks on the history: every quarter (every half-year on phones), January with its year.
        const months: number[] = [];
        const d0 = new Date(histFrom * DAY);
        for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() / DAY < today - 20; m.setUTCMonth(m.getUTCMonth() + 1)) {
          const mo = m.getUTCMonth();
          if (mo % (narrow ? 6 : 3) === 0) months.push(Math.round(m.getTime() / DAY));
        }
        const xs = shown.map((p) => x(p.t));
        return (
          <>
            <YGrid vals={ys.filter((yy) => yy >= lo && yy <= hi)} y={y} x0={L} x1={W - R} label={money} />
            {months.map((m) => (
              <text key={m} className="axt" x={x(m)} y={H - 10} textAnchor="middle">
                {monthTick(m, new Date(m * DAY).getUTCMonth() === 0)}
              </text>
            ))}
            <line className="ax" x1={x(today)} x2={x(today)} y1={T} y2={H - B} />
            <line className="dash" x1={x(today)} x2={x(last.day)} y1={y(p0)} y2={y(p0)} />
            {!narrow && (
              <text className="anns" x={x(last.day) + bw / 2 + 6} y={y(p0) + 4}>
                {noChange}
              </text>
            )}
            <path className="line" d={pathD(xs, shown.map((p) => y(p.v)))} />
            {bars.map((b) => {
              const bx = x(b.day);
              return (
                <g key={b.h}>
                  <line className="bandr95" x1={bx} x2={bx} y1={y(b.hi95)} y2={y(b.lo95)} />
                  <rect className="bandr" x={bx - bw / 2} y={y(b.hi)} width={bw} height={y(b.lo) - y(b.hi)} rx={bw / 4} />
                  {!narrow && (
                    <>
                      <text className="ann" x={bx + bw / 2 + 6} y={y(b.hi) + 4}>
                        {money(b.hi)}
                      </text>
                      <text className="ann" x={bx + bw / 2 + 6} y={y(b.lo) + 4}>
                        {money(b.lo)}
                      </text>
                    </>
                  )}
                  <text className="axt" x={bx} y={H - 10} textAnchor="middle">
                    {b.tick}
                  </text>
                </g>
              );
            })}
            <circle cx={x(today)} cy={y(p0)} r={5} fill="var(--field)" />
            {(() => {
              const sp = todaySpot(xs, shown.map((p) => y(p.v)), x(today), y(p0), todayText);
              return (
                <text className="ann" x={sp.x} y={sp.y} textAnchor={sp.anchor}>
                  {todayText}
                </text>
              );
            })()}
          </>
        );
      }}
    </Figure>
  );
}

/** Chapter 6: the typical and the 1-in-10 release-day move, drawn around today's price. */
export function MoveChart({
  label,
  typ,
  tail,
  p0,
  todayText,
  legend,
  delta,
  money,
}: {
  label: string;
  typ: number;
  tail: number;
  p0: number;
  todayText: string;
  legend: [string, string];
  delta: (v: number) => string;
  money: (v: number) => string;
}) {
  return (
    <Figure label={label} height={() => 190} testId="move-chart">
      {(W) => {
        const span = tail * 1.45;
        const x = linear(-span, span, 16, W - 16);
        const cy = 78;
        const marks: [number, string][] = [
          [-tail, "anns"],
          [-typ, "ann"],
          [typ, "ann"],
          [tail, "anns"],
        ];
        return (
          <>
            <rect x={x(-tail)} y={cy - 16} width={x(tail) - x(-tail)} height={32} rx={6} fill="var(--field-soft)" />
            <rect className="bandr" x={x(-typ)} y={cy - 16} width={x(typ) - x(-typ)} height={32} rx={6} />
            <line x1={x(0)} x2={x(0)} y1={cy - 28} y2={cy + 28} stroke="var(--ink)" strokeWidth={2} />
            <text className="ann" x={x(0)} y={cy - 36} textAnchor="middle">
              {todayText}
            </text>
            {marks.map(([d, cls]) => (
              <g key={d}>
                <text className={cls} x={x(d)} y={cy + 46} textAnchor="middle">
                  {`${d > 0 ? "+" : "−"}${delta(Math.abs(d))}`}
                </text>
                <text className="anns" x={x(d)} y={cy + 62} textAnchor="middle">
                  {money(p0 + d)}
                </text>
              </g>
            ))}
            {legend.map((l, i) => (
              <text key={l} className="anns" x={W / 2} y={166 + i * 16} textAnchor="middle">
                {l}
              </text>
            ))}
          </>
        );
      }}
    </Figure>
  );
}

/** The ticket's 12-month sparkline (no text: the change is written next to it). */
export function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = (hi - lo) * 0.08 || 1;
  const x = linear(0, v.length - 1, 2, 298);
  const y = linear(lo - pad, hi + pad, 62, 6);
  const d = pathD(v.map((_, i) => x(i)), v.map(y));
  return (
    <svg className="spark" viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={`${d}L${x(v.length - 1)} 64 L${x(0)} 64 Z`} fill="var(--field-soft)" />
      <path d={d} fill="none" stroke="var(--field)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
