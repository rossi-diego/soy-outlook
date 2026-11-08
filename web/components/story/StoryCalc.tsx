"use client";

// Chapter 5: the simplified hedging calculator. The arithmetic is lib/decision.ts, the same as the
// full panel on /track-record/ ("For analysts"): CBOT only, the hedge locked at today's close, the
// bad case at the 80% range's edge on the user's side (1 in 10), with that side's tail flag.
import { useId, useState } from "react";

import { adverse, adverseTail, type Currency, moneyAmount, parseVolume, pnlVsToday, type Side } from "@/lib/decision";
import { storyCopy } from "@/lib/i18n";
import { STORY_H } from "@/lib/story";
import type { Horizon } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Props = {
  horizons: Horizon[];
  /** Today's CBOT close, ¢/bu. */
  p0: number;
  buPerT: number;
  fx: number;
  currency: Currency;
  /** 1 / the one-tail nominal of the 80% range (10). */
  oneIn: number;
  /** Today's price as shown in the hero, in the chosen unit. */
  priceText: string;
};

export default function StoryCalc({ horizons, p0, buPerT, fx, currency, oneIn, priceText }: Props) {
  const { loc, f } = useI18n();
  const c = storyCopy(loc);
  const ids = useId();
  const [side, setSide] = useState<Side>("producer");
  const [tonnes, setTonnes] = useState(1000);
  const [volText, setVolText] = useState<string | null>(null);
  const [volError, setVolError] = useState<string | null>(null);
  const [hedgePct, setHedgePct] = useState(0);
  const volShown = volText ?? f.num(tonnes);
  const commitVolume = () => {
    const r = parseVolume(volShown, loc, "t");
    if (r.ok) {
      setTonnes(r.value);
      setVolText(null);
      setVolError(null);
    } else setVolError(r.error);
  };

  const loss = (h: Horizon, hedge: number) =>
    pnlVsToday(adverse(h, side).oneInTen, p0, { side, tonnes, hedge, currency, fx, buPerT });
  const money = (v: number) => moneyAmount(v, currency, loc);
  // One scale for the three bars: the unhedged bad case of the widest one.
  const max = Math.max(...horizons.map((h) => Math.abs(Math.min(0, loss(h, 0)))), 1);
  const h3 = horizons.find((h) => h.h === STORY_H) ?? horizons[0];
  const hedge = hedgePct / 100;

  return (
    <div className="calc" data-testid="story-calc">
      <div className="controls">
        <div className="ctl">
          <span className="lab" id={`${ids}-side`}>
            {c.iAm}
          </span>
          <div className="seg" role="group" aria-labelledby={`${ids}-side`}>
            {(["producer", "buyer"] as const).map((sd) => (
              <button key={sd} type="button" aria-pressed={side === sd} onClick={() => setSide(sd)}>
                {sd === "producer" ? c.seller : c.buyer}
              </button>
            ))}
          </div>
        </div>
        <div className="ctl">
          <label className="lab" htmlFor={`${ids}-vol`}>
            {c.volume}
          </label>
          <input
            id={`${ids}-vol`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={volShown}
            onChange={(e) => setVolText(e.target.value)}
            onBlur={commitVolume}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitVolume();
            }}
            aria-invalid={volError !== null}
            aria-describedby={volError ? `${ids}-volerr` : undefined}
          />
        </div>
        <div className="ctl">
          <label className="lab" htmlFor={`${ids}-hedge`}>
            {c.hedged}: <span className="num" data-testid="calc-hedge">{hedgePct}%</span>
          </label>
          <input
            id={`${ids}-hedge`}
            type="range"
            min={0}
            max={100}
            step={5}
            value={hedgePct}
            aria-valuetext={`${hedgePct}%`}
            onChange={(e) => setHedgePct(Number(e.target.value))}
          />
        </div>
      </div>
      {volError && (
        <p id={`${ids}-volerr`} className="text-sm font-medium text-warn" role="alert">
          {volError}
        </p>
      )}
      <div className="out">
        <p className="small">{c.badCase(oneIn, priceText)}</p>
        {horizons.map((h) => {
          const l = loss(h, hedge);
          const tail = adverseTail(h.coverage, side);
          return (
            <div className="orow" key={h.h} data-testid={`calc-${h.h}`}>
              <span className="lbl">{f.horizon(h.h)}</span>
              <div className="track" aria-hidden="true">
                <i style={{ width: `${(Math.abs(Math.min(0, l)) / max) * 100}%` }} />
              </div>
              <span className="v num" data-testid="calc-loss">
                {money(l)}
              </span>
              {tail.warn && tail.miss !== null && (
                <span className="warn" data-testid="calc-warn">
                  {side === "producer" ? c.tailDown(f.pct(tail.miss)) : c.tailUp(f.pct(tail.miss))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="hint" aria-live="polite">
        <span data-testid="calc-hint">
          → {hedgePct < 50 ? c.hintHalf : c.hintAt(hedgePct)} <b className="num">{money(loss(h3, Math.max(hedge, 0.5)))}</b>.
        </span>
        {hedgePct < 50 && (
          <button type="button" onClick={() => setHedgePct(50)}>
            {c.tryHalf}
          </button>
        )}
      </div>
    </div>
  );
}
