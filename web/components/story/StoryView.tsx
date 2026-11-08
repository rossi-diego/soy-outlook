"use client";

// The home page as a story (owner-approved mockup, 2026-11): the answer first (hero ticket and
// range ladder), then why it is shaped this way (the problem, the model contest, the tested
// ranges), today's outlook, what it means in money, and the next report to watch. Every number
// comes from the published data; the copy lives in lib/i18n.ts (storyCopy).
import Link from "next/link";

import ChartData from "@/components/ChartData";
import { PriceHeadline, SettingsControls, type Settings, useIssuedLabel, useOutlookSettings } from "@/components/OutlookSettings";
import StoryCalc from "@/components/story/StoryCalc";
import { BacktestChart, type Bar, dayOf, HistoryChart, MoveChart, OutlookChart, Spark } from "@/components/story/StoryCharts";
import { convert, decimalsFor, type Unit } from "@/lib/format";
import { storyCopy } from "@/lib/i18n";
import { heldCount, inTen, ladderDomain, linear, missSide, type OutlookCore, STORY_H, type StoryView as Story, ticks, weekdayOf } from "@/lib/story";
import type { Meta } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Props = { meta: Meta; outlook: OutlookCore; story: Story };

/** A price in the chosen unit, compact: "$439", "US$ 439", "R$ 145,12", "1,194¢". */
function usePrice(unit: Unit) {
  const { f, pt } = useI18n();
  return (v: number, d: number = decimalsFor(unit)) => {
    const n = f.num(v, d);
    if (unit === "usd_t") return pt ? `US$ ${n}` : `$${n}`;
    if (unit === "brl_sack") return `R$ ${n}`;
    return `${n}¢`;
  };
}

/** A price difference in USD/t (an error, a move) in the chosen unit; premium and discount cancel out. */
function deltaIn(unit: Unit, s: Settings, meta: Meta) {
  return (usdT: number) =>
    unit === "usd_t" ? usdT : unit === "brl_sack" ? (usdT * s.fx * meta.consts.sack_kg) / 1000 : (usdT / meta.consts.bu_per_t) * 100;
}

/** Decimals for a difference: one for USD/t and ¢/bu, two for R$/sack. */
const deltaDec = (unit: Unit) => (unit === "brl_sack" ? 2 : 1);

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2 4h7M13 4h1M2 12h1M7 12h7M11 2.5v3M5 10.5v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StoryView({ meta, outlook, story }: Props) {
  const { loc, f, t, d } = useI18n();
  const c = storyCopy(loc);
  const s = useOutlookSettings(meta);
  const { unit, a } = s;
  const price = usePrice(unit);
  const delta = deltaIn(unit, s, meta);
  const issued = useIssuedLabel(meta);
  const cv = (cBu: number) => convert(cBu, unit, a);
  const usdT = (cBu: number) => (cBu / 100) * meta.consts.bu_per_t;
  const usd = (v: number) => (loc === "pt-BR" ? `US$ ${f.num(v, 0)}` : `$${f.num(v, 0)}`);

  const hs = [...outlook.horizons].sort((x, y) => x.h - y.h);
  const far = hs[hs.length - 1];
  const p0c = outlook.last.c_bu;
  const p0 = cv(p0c);
  const nominal80 = hs[0].coverage.nominal["80"];
  const n80 = inTen(nominal80);
  const n95 = inTen(hs[0].coverage.nominal["95"], 20);
  const oneIn = Math.round(1 / meta.intervals.tail_nominal_80);
  const since = meta.splits.validation[0].slice(0, 4);
  const valYears = `${meta.splits.validation[0].slice(0, 4)}–${meta.splits.validation[1].slice(0, 4)}`;
  const sgnPct = (v: number) => `${v >= 0 ? "+" : "−"}${f.num(Math.abs(Math.round(v)), 0)}%`;

  // ---- hero: ticket and range ladder
  const asOfDay = dayOf(outlook.as_of_close);
  const hist = story.history.t.map((day, i) => ({ t: day, c: story.history.c[i] }));
  const year = hist.filter((p) => p.t >= asOfDay - 365);
  const change12 = year.length > 1 ? (year[year.length - 1].c / year[0].c - 1) * 100 : null;
  const ladder = hs.map((h) => ({ h, lo: cv(h.q100), hi: cv(h.q900) }));
  const [dLo, dHi] = ladderDomain([...ladder.flatMap((r) => [r.lo, r.hi]), p0]);
  const sc = linear(dLo, dHi, 0, 100);
  const ladderTicks = ticks(dLo, dHi, 5).filter((v) => sc(v) > 2 && sc(v) < 98);
  const tickDec = unit === "brl_sack" && ladderTicks.some((v) => !Number.isInteger(v)) ? 2 : 0;

  // ---- chapter 1: price history (CBOT USD/t) and the stress episodes
  const histUsd = hist.map((p) => usdT(p.c));
  const moves = story.stress.map((e) => Math.abs(Math.round(e.pct)));
  const episodes = story.stress.map((e, i) => ({
    n: i + 1,
    name: d(e.name),
    move: c.ch1Move(sgnPct(e.pct), STORY_H),
    day: dayOf(e.start),
  }));

  // ---- chapter 2 and 3
  const contest = story.contest;
  const maxMae = Math.max(...contest.map((r) => r.mae), 1);
  const nContest = contest.find((r) => r.model === "rw")?.n ?? contest[0]?.n ?? 0;
  const rwWins = contest[0]?.model === "rw" && meta.champion[String(STORY_H)] === "rw";
  const h3 = hs.find((h) => h.h === STORY_H) ?? hs[0];
  const cov3 = h3.coverage;
  const vHeld = heldCount(story.backtest, "v");
  const hHeld = heldCount(story.backtest, "h");
  const backRows = story.backtest.t.map((day, i) => ({
    t: day,
    lo: story.backtest.lo[i],
    hi: story.backtest.hi[i],
    a: story.backtest.a[i],
    holdout: story.backtest.split[i] === "h",
  }));

  // ---- chapter 4: in the chosen unit
  const bars: Bar[] = hs.map((h) => ({
    h: h.h,
    day: dayOf(h.target_date),
    lo: cv(h.q100),
    hi: cv(h.q900),
    lo95: cv(h.q025),
    hi95: cv(h.q975),
    tick: `+${h.h}m`,
  }));
  const histUnit = hist.map((p) => ({ t: p.t, v: cv(p.c) }));
  const monthTick = (day: number, jan: boolean) => {
    const dt = new Date(day * 86_400_000);
    return jan ? String(dt.getUTCFullYear()) : f.monthAbbr(dt.getUTCMonth() + 1);
  };
  const dec = decimalsFor(unit);
  const tbl = (v: number) => f.num(cv(v), dec);

  // ---- chapter 6
  const next = meta.next_wasde;
  const mv = story.move;
  const dd = deltaDec(unit);

  return (
    <div className="story">
      {/* HERO: the answer first */}
      <section className="hero" aria-labelledby="story-title">
        <div className="herogrid">
          <div className="herotext">
            <span className="eyebrow">{c.eyebrow}</span>
            <h1 id="story-title" data-testid="story-title">
              {c.h1Lead} <em>{c.h1Accent(f.monthName(far.target_date.slice(0, 7)))}</em>
            </h1>
            <p className="lede">{c.lede(n80, since)}</p>
          </div>
          <div className="heroside">
            <details className="settings" data-testid="settings">
              <summary>
                <span data-testid="settings-state">{c.settingsState(f.unit(unit), s.fob)}</span>
                <span className="btn">
                  <GearIcon />
                  {c.settings}
                </span>
              </summary>
              <div className="panel">
                <SettingsControls s={s} meta={meta} />
              </div>
            </details>
            <aside className="ticket" aria-label={c.ticketLabel(s.fob)} data-testid="ticket">
              <div className="tk-top">
                <span>{c.ticketLabel(s.fob)}</span>
                <span>{c.ticketClose(f.date(outlook.as_of_close))}</span>
              </div>
              <div className="tk-price">
                <span className="num" data-testid="ticket-price">
                  {price(p0)}
                </span>
                <small>{c.perUnit[unit]}</small>
              </div>
              <Spark v={year.map((p) => cv(p.c))} />
              <div className="tk-row">
                <span>{c.months12}</span>
                <span className="num">{change12 === null ? "—" : sgnPct(change12)}</span>
              </div>
              <div className="tk-row">
                <span>{c.nextReport}</span>
                <span className="num">{next ? f.date(next) : c.noDate}</span>
              </div>
            </aside>
          </div>
        </div>

        <div
          className="ladder"
          role="group"
          aria-label={c.ladderLabel(f.unit(unit))}
          data-testid="ladder"
          // Room for the end labels on phones, where the track spans the full width (globals.css).
          style={{ "--lpad": unit === "brl_sack" ? "84px" : unit === "c_bu" ? "62px" : "46px" } as React.CSSProperties}
        >
          {ladder.map(({ h, lo, hi }) => {
            const v = h.coverage.validation;
            return (
              <div className="lrow" key={h.h} data-testid={`ladder-${h.h}`}>
                <div className="lwhen">
                  <b>{c.inH(f.horizon(h.h))}</b>
                  <span>{f.date(h.target_date)}</span>
                </div>
                <div className="ltrack" aria-hidden="true">
                  <div className="lin">
                    <div className="bar" style={{ left: `${sc(lo)}%`, width: `${sc(hi) - sc(lo)}%` }} />
                    <div className="now" style={{ left: `${sc(p0)}%` }} />
                    <span className="lo" style={{ left: `${sc(lo)}%` }}>
                      {price(lo)}
                    </span>
                    <span className="hi" style={{ left: `${sc(hi)}%` }}>
                      {price(hi)}
                    </span>
                  </div>
                </div>
                <div className="lpct">
                  <span className="sr-only">
                    {price(lo)} {c.to} {price(hi)},{" "}
                  </span>
                  {sgnPct((lo / p0 - 1) * 100)} {c.to} {sgnPct((hi / p0 - 1) * 100)}
                  {h.coverage.warn80 && v && (
                    <span className="flag" data-testid="ladder-flag">
                      {c.heldFlag(inTen(v.cover80), n80)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="laxis" aria-hidden="true">
            <span />
            <div className="ticks">
              <div className="lin">
                {ladderTicks.map((v, i) => (
                  <span key={v} className={i % 2 ? "alt" : undefined} style={{ left: `${sc(v)}%` }}>
                    {price(v, tickDec)}
                  </span>
                ))}
              </div>
            </div>
            <span />
          </div>
        </div>
        <div className="small space-y-1">
          <p>{c.ladderNote(n80)}</p>
          <PriceHeadline s={s} last={p0c} />
          <p data-testid="issued">{issued}.</p>
        </div>
      </section>

      {/* 1. The problem */}
      <section className="chapter" aria-labelledby="ch1">
        <div className="head col">
          <span className="eyebrow">{c.ch1Eyebrow}</span>
          <h2 id="ch1">{c.ch1Title}</h2>
          <p>
            {c.ch1Body(
              String(new Date(hist[0].t * 86_400_000).getUTCFullYear()),
              usd(Math.min(...histUsd)),
              usd(Math.max(...histUsd)),
              Math.min(...moves),
              Math.max(...moves),
            )}
          </p>
        </div>
        <HistoryChart
          label={c.ch1Chart(String(new Date(hist[0].t * 86_400_000).getUTCFullYear()))}
          t={hist.map((p) => p.t)}
          v={histUsd}
          episodes={episodes}
          todayText={`${c.today} ${usd(histUsd[histUsd.length - 1])}`}
          money={usd}
        />
        <ol className="eplist small" data-testid="episode-list">
          {episodes.map((e) => (
            <li key={e.n}>
              <b className="num">{e.n}</b> {e.name}: {e.move}
            </li>
          ))}
        </ol>
        <p className="cap">{c.ch1Cap(f.date(isoOf(hist[0].t)), f.date(outlook.as_of_close))}</p>
      </section>

      {/* 2. The contest */}
      <section className="chapter" aria-labelledby="ch2">
        <div className="head col">
          <span className="eyebrow">{c.ch2Eyebrow}</span>
          <h2 id="ch2">{c.ch2Title(contest.length)}</h2>
          <p>{c.ch2Body(nContest)}</p>
        </div>
        <div className="contest" data-testid="contest">
          <div className="crow" aria-hidden="true">
            <span />
            <span />
            <span className="chead" style={{ textAlign: "right" }}>
              {c.typicalMiss}, {f.unit(unit)}
            </span>
          </div>
          {contest.map((r, i) => (
            <div className={`crow${i === 0 ? " win" : ""}`} key={r.model} data-testid={`contest-${r.model}`}>
              <div className="lbl">
                {c.model[r.model][0]}
                <small>{c.model[r.model][1]}</small>
              </div>
              <div className="track" aria-hidden="true">
                <i style={{ width: `${(r.mae / (maxMae * 1.04)) * 100}%` }} />
              </div>
              <div className="val">
                <span className="sr-only">
                  {c.typicalMiss}, {f.unit(unit)}:{" "}
                </span>
                {f.num(delta(r.mae), dd)} · {i === 0 ? c.lowest : `${r.mase >= 1 ? "+" : "−"}${f.num(Math.abs((r.mase - 1) * 100), 1)}%`}
              </div>
            </div>
          ))}
        </div>
        <p className="pull">{rwWins ? c.pull : c.pullNoWin}</p>
        <p className="cap">
          {c.ch2Cap(f.unit(unit), valYears, story.holmNone)}{" "}
          <Link className="more" href="/track-record/">
            {t("Track record", "Histórico")} →
          </Link>
        </p>
      </section>

      {/* 3. The turn */}
      <section className="chapter" aria-labelledby="ch3">
        <div className="head col">
          <span className="eyebrow">{c.ch3Eyebrow}</span>
          <h2 id="ch3">{c.ch3Title}</h2>
          <p>{c.ch3Body(story.backtest.t.length)}</p>
        </div>
        <div className="stats" data-testid="stats">
          <div className="stat">
            <div className="n num" style={{ color: "var(--field)" }} data-testid="stat-held">
              {vHeld.held} {c.of} {vHeld.n}
            </div>
            <div className="t">{c.statHeld(cov3.validation?.years ?? valYears)}</div>
          </div>
          <div className="stat">
            <div className="n num" data-testid="stat-rate">
              {f.pct(cov3.validation?.cover80)}
            </div>
            <div className="t">{c.statRate(f.pct(nominal80))}</div>
          </div>
          <div className="stat">
            <div className="n num" data-testid="stat-holdout">
              {f.pct(cov3.holdout?.cover80)}
            </div>
            <div className="t">{c.statHoldout(cov3.holdout?.years ?? "", hHeld.held, hHeld.n)}</div>
          </div>
        </div>
        {backRows.length > 0 && (
          <BacktestChart label={c.ch3Chart(backRows.length)} rows={backRows} examText={c.ch3Exam(cov3.holdout?.years ?? "")} money={usd} />
        )}
        <p className="cap">
          <span className="dot" style={{ background: "var(--field)" }} aria-hidden="true" />
          {c.ch3CapIn} &nbsp; <span className="dot" style={{ background: "var(--warn)" }} aria-hidden="true" />
          {c.ch3CapOut}. {c.ch3Cap(cov3.holdout?.years ?? "")}
        </p>
      </section>

      {/* 4. Today's outlook */}
      <section className="chapter" aria-labelledby="ch4">
        <div className="head col">
          <span className="eyebrow">{c.ch4Eyebrow}</span>
          <h2 id="ch4">{c.ch4Title(price(p0))}</h2>
          <p>{c.ch4Body(n80, n95)}</p>
        </div>
        <OutlookChart
          label={c.ch4Chart(f.unit(unit))}
          hist={histUnit}
          today={asOfDay}
          p0={p0}
          bars={bars}
          noChange={c.ch4NoChange}
          todayText={`${c.today} ${price(p0)}`}
          money={(v) => price(v, unit === "brl_sack" ? 0 : decimalsFor(unit))}
          monthTick={monthTick}
        />
        <div className="cap space-y-1" data-testid="outlook-caption">
          {hs
            .filter((h) => h.coverage.warn80 && h.coverage.validation)
            .map((h) => (
              <p key={h.h} className="text-warn" data-testid="warn-caption">
                {c.ch4Warn(h.h, f.pct(h.coverage.validation!.cover80), h.coverage.validation!.years, f.pct(nominal80), missSide(h))}
              </p>
            ))}
          <p>{c.ch4Unit(f.unitLong(unit, s.fob))}</p>
        </div>
        <ChartData
          testId="outlook-data"
          caption={c.ch4Table}
          columns={[
            t("Horizon", "Horizonte"),
            t("Target date", "Data-alvo"),
            `${t("Central", "Central")}, ${f.unit(unit)}`,
            t("80% range", "Faixa de 80%"),
            t("95% range", "Faixa de 95%"),
            t("80% held (validation)", "Acerto 80% (validação)"),
          ]}
          rows={[
            [t("Today", "Hoje"), f.date(outlook.as_of_close), tbl(p0c), "—", "—", "—"],
            ...hs.map((h) => [
              f.horizon(h.h),
              f.date(h.target_date),
              tbl(h.central),
              `${tbl(h.q100)} – ${tbl(h.q900)}`,
              `${tbl(h.q025)} – ${tbl(h.q975)}`,
              f.pct(h.coverage.validation?.cover80),
            ]),
          ]}
        />
      </section>

      {/* 5. Act */}
      <section className="chapter" aria-labelledby="ch5">
        <div className="head col">
          <span className="eyebrow">{c.ch5Eyebrow}</span>
          <h2 id="ch5">{c.ch5Title}</h2>
          <p>{c.ch5Body(oneIn)}</p>
        </div>
        <StoryCalc horizons={hs} p0={p0c} buPerT={meta.consts.bu_per_t} fx={s.fx} currency={unit === "brl_sack" ? "brl" : "usd"} oneIn={oneIn} priceText={price(p0)} />
        <p className="cap">
          {c.ch5Cap}{" "}
          <Link className="more" href="/track-record/#for-analysts">
            {c.ch5More}
          </Link>
        </p>
      </section>

      {/* 6. Next event */}
      <section className="chapter" aria-labelledby="ch6">
        <div className="event">
          <div className="head">
            <span className="eyebrow">{c.ch6Eyebrow}</span>
            <h2 id="ch6">{next ? c.ch6Title(weekdayOf(next)) : c.ch6TitleNone}</h2>
            <p className="date" data-testid="next-wasde">
              {next ? `${f.date(next, "long")} · 12:00 ET` : c.noDate}
            </p>
            {mv && (
              <p data-testid="move-text">
                {c.ch6Body(`${f.num(delta(mv.typical_usd_t), dd)} ${f.unit(unit)}`, `${f.num(delta(mv.one_in_ten_usd_t), dd)} ${f.unit(unit)}`)}
              </p>
            )}
            <p>
              <Link className="more" href="/wasde/">
                {c.ch6Link} →
              </Link>
            </p>
          </div>
          {mv && (
            <MoveChart
              label={c.ch6Chart(
                `${f.num(delta(mv.typical_usd_t), dd)} ${f.unit(unit)}`,
                `${f.num(delta(mv.one_in_ten_usd_t), dd)} ${f.unit(unit)}`,
                price(p0),
              )}
              typ={delta(mv.typical_usd_t)}
              tail={delta(mv.one_in_ten_usd_t)}
              p0={p0}
              todayText={`${c.today} ${price(p0)}`}
              legend={c.ch6Legend}
              delta={(v) => f.num(v, dd)}
              money={(v) => price(v)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
