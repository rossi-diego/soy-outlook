"use client";

import { useState } from "react";

import ChartData from "@/components/ChartData";
import RadioGroup from "@/components/RadioGroup";
import {
  adverse,
  adverseTail,
  type Currency,
  gridAt,
  moneyAmount,
  parsePrice,
  parseVolume,
  pnlVsToday,
  profile,
  type Side,
  type TargetPosition,
  targetPosition,
  toTonnes,
  type VolumeUnit,
} from "@/lib/decision";
import { type Assumptions, convert, type Unit } from "@/lib/format";
import type { Horizon } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Props = {
  horizons: Horizon[];
  p0: number;
  buPerT: number;
  sackKg: number;
  fx: number;
  /** The page's price unit and assumptions: the target is typed and placed in this unit. */
  unit: Unit;
  a: Assumptions;
  /** Pre-registered display rules (meta.intervals, config.py). */
  readoutLevels: number[];
  tailObsMin: number;
};

function Tag({ children, warn = false, title }: { children: React.ReactNode; warn?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2 py-px text-[0.7rem] font-medium leading-5 ${
        warn ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

/** The P&L vs today at each 5% step of the range, on one scale shared by the three horizons. */
function Strip({
  pts,
  lo,
  hi,
  adverseLevel,
  label,
}: {
  pts: { level: number; pnl: number }[];
  lo: number;
  hi: number;
  adverseLevel: number;
  label: string;
}) {
  const W = 300;
  const pad = 6;
  const x = (v: number) => pad + ((v - lo) / (hi - lo || 1)) * (W - 2 * pad);
  const zero = x(0);
  return (
    <svg viewBox={`0 0 ${W} 28`} className="h-7 w-full" role="img" aria-label={label}>
      <line x1={x(pts[0].pnl)} x2={x(pts[pts.length - 1].pnl)} y1={14} y2={14} stroke="var(--grid)" strokeWidth={6} strokeLinecap="round" />
      <line x1={zero} x2={zero} y1={3} y2={25} stroke="var(--ink-2)" strokeWidth={1} />
      {pts.map((p) => {
        const isAdverse = Math.abs(p.level - adverseLevel) < 1e-6;
        return (
          <circle
            key={p.level}
            cx={x(p.pnl)}
            cy={14}
            r={isAdverse ? 4.5 : 2.5}
            fill={p.pnl < 0 ? "var(--down)" : "var(--up)"}
            stroke={isAdverse ? "var(--ink)" : "none"}
            strokeWidth={isAdverse ? 1.25 : 0}
            opacity={isAdverse ? 1 : 0.75}
          />
        );
      })}
    </svg>
  );
}

/** Inline key for the dot strips (unit B): the marks explain themselves next to the strips. */
function StripLegend({ vs }: { vs: string }) {
  const { t } = useI18n();
  const dot = (fill: string, ring = false) => (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true">
      <circle cx={6} cy={6} r={ring ? 4.5 : 3} fill={fill} stroke={ring ? "var(--ink)" : "none"} strokeWidth={ring ? 1.25 : 0} />
    </svg>
  );
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" data-testid="strip-legend">
      <li className="inline-flex items-center gap-1.5">
        {dot("var(--down)")}
        {t("loss", "perda")}
      </li>
      <li className="inline-flex items-center gap-1.5">
        {dot("var(--up)")}
        {t("gain", "ganho")}
      </li>
      <li className="inline-flex items-center gap-1.5">
        {dot("var(--down)", true)}
        {t("1-in-10 adverse level", "nível desfavorável de 1 em 10")}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 6 12" className="h-3 w-1.5 shrink-0" aria-hidden="true">
          <line x1={3} x2={3} y1={0} y2={12} stroke="var(--ink-2)" strokeWidth={1.25} />
        </svg>
        {t(`${vs} today`, `${vs} hoje`)}
      </li>
      <li className="text-muted">
        {t(
          "one dot per 5% step of the range; one scale shared by all three horizons",
          "um ponto por passo de 5% da faixa; uma escala comum aos três horizontes",
        )}
      </li>
    </ul>
  );
}

export default function DecisionPanel({ horizons, p0, buPerT, sackKg, fx, unit, a, readoutLevels, tailObsMin }: Props) {
  const { t, f, loc, pt } = useI18n();
  const [side, setSide] = useState<Side>("producer");
  // Unit B: under pt-BR the defaults are reais and 60 kg sacks; an explicit choice wins.
  const [currencyChoice, setCurrency] = useState<Currency | null>(null);
  const currency: Currency = currencyChoice ?? (pt ? "brl" : "usd");
  const [volUnitChoice, setVolUnit] = useState<VolumeUnit | null>(null);
  const volUnit: VolumeUnit = volUnitChoice ?? (pt ? "sc" : "t");
  const [hedgePct, setHedgePct] = useState(0);
  // The physical volume is kept in tonnes, so switching t <-> sacks never changes the exposure.
  const [tonnesChoice, setTonnes] = useState<number | null>(null);
  const tonnes = tonnesChoice ?? (pt ? toTonnes(20_000, "sc", sackKg) : 1000);
  const fromTonnes = (v: number) => (volUnit === "t" ? v : (v * 1000) / sackKg);
  const [volText, setVolText] = useState<string | null>(null);
  const [volError, setVolError] = useState<string | null>(null);
  const volShown = volText ?? f.num(Math.round(fromTonnes(tonnes)));
  const commitVolume = () => {
    const r = parseVolume(volShown, loc, volUnit);
    if (r.ok) {
      setTonnes(toTonnes(r.value, volUnit, sackKg));
      setVolText(null);
      setVolError(null);
    } else setVolError(r.error);
  };
  const [targetText, setTargetText] = useState("");
  const [target, setTarget] = useState<number | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const commitTarget = () => {
    const r = parsePrice(targetText, loc);
    if (r.ok) {
      setTarget(r.value);
      setTargetError(null);
    } else setTargetError(r.error);
  };

  const x = { side, tonnes, hedge: hedgePct / 100, currency, fx, buPerT };
  const producer = side === "producer";
  const vs = producer ? t("selling", "vender") : t("buying", "comprar");
  const rows = horizons.map((h) => ({ h, adv: adverse(h, side), prof: profile(h, p0, x) }));
  const all = rows.flatMap((r) => r.prof.map((p) => p.pnl));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const usdT = (c: number) => (c / 100) * buPerT;
  const money = (v: number) => moneyAmount(v, currency, loc);
  const rolls = horizons.filter((h) => h.contract.crosses_roll).map((h) => f.horizon(h.h));
  const open = fromTonnes(tonnes * (1 - hedgePct / 100));
  const volWord = volUnit === "t" ? "t" : t("sacks", "sc");
  const everyRolls = rolls.length === horizons.length;
  const p = (l: number) => `p${Math.round(l * 100)}`;
  const positionText = (pos: TargetPosition) =>
    pos.kind === "below"
      ? t(`Your target sits below the ${p(pos.level)} of the tested range`, `Seu alvo fica abaixo do ${p(pos.level)} da faixa testada`)
      : pos.kind === "above"
        ? t(`Your target sits above the ${p(pos.level)} of the tested range`, `Seu alvo fica acima do ${p(pos.level)} da faixa testada`)
        : t(
            `Your target sits between the ${p(pos.lo)} and ${p(pos.hi)} of the tested range`,
            `Seu alvo fica entre o ${p(pos.lo)} e o ${p(pos.hi)} da faixa testada`,
          );

  return (
    <section className="card space-y-5 p-5" aria-labelledby="decision-title" data-testid="decision-panel">
      <div className="space-y-2">
        <h2 id="decision-title" className="text-lg font-semibold">
          {t(`Budgeting and hedging: downside vs ${vs} today`, `Orçamento e hedge: perda possível contra ${vs} hoje`)}
        </h2>
        <div className="flex flex-wrap gap-1.5" data-testid="decision-labels">
          <Tag>{t("illustrative", "ilustrativo")}</Tag>
          <Tag>{t("range-based, not VaR", "baseado em faixas, não é VaR")}</Tag>
          <Tag>{t("CBOT only", "só CBOT")}</Tag>
          <Tag>{t("basis unhedged", "base sem hedge")}</Tag>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          {t(
            `What the tested ranges would mean for your volume if CBOT ended at their adverse end (${
              producer ? "prices lower" : "prices higher"
            }). Hedged volume is treated as locked at today's close of ${f.num(p0, 0)}¢/bu.`,
            `O que as faixas testadas significariam para o seu volume se a CBOT terminasse na ponta desfavorável (${
              producer ? "preços mais baixos" : "preços mais altos"
            }). O volume com hedge é tratado como travado no fechamento de hoje, ${f.num(p0, 0)}¢/bu.`,
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t("Your side", "Seu lado")}</p>
          <RadioGroup
            legend={t("Your side", "Seu lado")}
            value={side}
            onChange={setSide}
            options={[
              { id: "producer", label: t("Producer (long)", "Produtor (comprado)") },
              { id: "buyer", label: t("Buyer (short)", "Comprador (vendido)") },
            ]}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tonnes" className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("Volume", "Volume")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="tonnes"
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
              aria-describedby="tonnes-help"
              className={`tabular w-32 rounded-md border bg-surface px-2 py-1.5 ${volError ? "border-warn-line" : "border-line"}`}
            />
            <RadioGroup
              size="sm"
              legend={t("Volume unit", "Unidade de volume")}
              value={volUnit}
              onChange={(u) => {
                setVolUnit(u);
                setVolText(null);
                setVolError(null);
              }}
              options={[
                { id: "t", label: t("tonnes", "toneladas") },
                { id: "sc", label: t("sacks", "sacas") },
              ]}
            />
          </div>
          <p id="tonnes-help" className={`text-xs ${volError ? "font-medium text-warn" : "text-muted"}`} role={volError ? "alert" : undefined}>
            {volError
              ? `${volError} ${t("Using", "Usando")} ${f.num(Math.round(fromTonnes(tonnes)))}.`
              : volUnit === "sc"
                ? t(`Physical volume exposed, 60 kg sacks (${f.num(tonnes)} t)`, `Volume físico exposto, sacas de 60 kg (${f.num(tonnes)} t)`)
                : t("Physical volume exposed", "Volume físico exposto")}
          </p>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor="hedge" className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted">
            <span>{t("Hedge ratio", "Percentual com hedge")}</span>
            <span className="tabular normal-case text-ink" data-testid="hedge-value">
              {hedgePct}% {t("hedged", "com hedge")} · {f.num(Math.round(open))} {volWord} {t("open", "em aberto")}
            </span>
          </label>
          <input
            id="hedge"
            type="range"
            min={0}
            max={100}
            step={5}
            value={hedgePct}
            aria-valuetext={t(
              `${hedgePct}% hedged, ${f.num(Math.round(open))} ${volUnit === "t" ? "tonnes" : "sacks"} open`,
              `${hedgePct}% com hedge, ${f.num(Math.round(open))} ${volUnit === "t" ? "toneladas" : "sacas"} em aberto`,
            )}
            onChange={(e) => setHedgePct(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <p className="text-xs text-muted">
            {t("CBOT futures at today's close; margin and rolls ignored.", "Futuros da CBOT no fechamento de hoje; margem e rolagens ignoradas.")}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t("Currency", "Moeda")}</p>
          <RadioGroup
            legend={t("Currency", "Moeda")}
            value={currency}
            onChange={setCurrency}
            options={[
              { id: "usd", label: "USD" },
              { id: "brl", label: "BRL" },
            ]}
          />
          <p className="text-xs text-muted">
            {currency === "brl" ? t(`at ${f.num(fx, 2)} BRL/USD, held fixed`, `a ${f.num(fx, 2)} BRL/USD, fixo`) : " "}
          </p>
        </div>
        <div className="w-full max-w-xs space-y-1 sm:w-56">
          <label htmlFor="target" className="text-xs font-medium uppercase tracking-wide text-muted">
            {t(`Target price, ${f.unit(unit)}`, `Preço-alvo, ${f.unit(unit)}`)}
          </label>
          <input
            id="target"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            onBlur={commitTarget}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTarget();
            }}
            aria-invalid={targetError !== null}
            aria-describedby="target-help"
            className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${targetError ? "border-warn-line" : "border-line"}`}
          />
          <p id="target-help" className={`text-xs ${targetError ? "font-medium text-warn" : "text-muted"}`} role={targetError ? "alert" : undefined}>
            {targetError ?? t("Shows where it sits in each range; not a chance of reaching it.", "Mostra onde ele fica em cada faixa; não é a chance de atingi-lo.")}
          </p>
        </div>
      </div>

      <StripLegend vs={vs} />

      <div className="grid gap-4 md:grid-cols-3">
        {rows.map(({ h, adv, prof }) => {
          const tail = adverseTail(h.coverage, side);
          const tenth = pnlVsToday(adv.oneInTen, p0, x);
          const fortieth = pnlVsToday(adv.oneInForty, p0, x);
          const weak = h.tail_obs_95 < tailObsMin;
          const pos =
            target === null
              ? null
              : targetPosition(target, readoutLevels, (l) => {
                  const c = gridAt(h.grid, l);
                  return c === null ? null : convert(c, unit, a);
                });
          return (
            <article key={h.h} className="flex flex-col gap-2 rounded-lg border border-line p-4" data-testid={`decision-${h.h}`}>
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-ink-2">{t(`${f.horizon(h.h)} ahead`, `${f.horizon(h.h)} à frente`)}</h3>
                <span className="text-xs text-muted">{f.date(h.target_date)}</span>
              </header>
              <p className="text-xs text-muted">{t("1 in 10 adverse", "1 em 10 desfavorável")}</p>
              <p className={`tabular text-2xl font-semibold tracking-tight ${tenth < 0 ? "text-down" : "text-up"}`} data-testid="downside10">
                {money(tenth)}
              </p>
              <p className="text-xs text-ink-2">
                {t("if CBOT is", "se a CBOT estiver")}{" "}
                {producer ? t("at or below", "em ou abaixo de") : t("at or above", "em ou acima de")}{" "}
                <span className="tabular">{f.num(adv.oneInTen, 0)}¢/bu</span> ({f.signed(usdT(adv.oneInTen) - usdT(p0), 1)} USD/t{" "}
                {t("vs today", "contra hoje")})
              </p>
              {tail.warn && tail.miss !== null && (
                <p className="text-xs font-medium text-warn" data-testid="decision-warn">
                  <Tag
                    warn
                    title={t(
                      "Validation miss rate on this side more than 5 percentage points above the 10% one-tail nominal",
                      "Taxa de erro deste lado na validação mais de 5 pontos percentuais acima dos 10% nominais por cauda",
                    )}
                  >
                    {t("tail above 10%", "cauda acima de 10%")}
                  </Tag>{" "}
                  {producer
                    ? t(
                        `Prices fell below this range in ${f.pct(tail.miss)} of tested reports (10% nominal): this downside is likely understated.`,
                        `Os preços caíram abaixo desta faixa em ${f.pct(tail.miss)} dos relatórios testados (10% nominal): esta perda provavelmente está subestimada.`,
                      )
                    : t(
                        `Prices rose above this range in ${f.pct(tail.miss)} of tested reports (10% nominal): this downside is likely understated.`,
                        `Os preços subiram acima desta faixa em ${f.pct(tail.miss)} dos relatórios testados (10% nominal): esta perda provavelmente está subestimada.`,
                      )}
                </p>
              )}
              <p className={weak ? "text-xs text-muted" : "text-sm text-ink-2"} data-testid="downside40" data-weak={weak ? "true" : "false"}>
                {t("Rough 1 in 40:", "Aprox. 1 em 40:")}{" "}
                <span className={`tabular ${weak ? "" : "font-medium text-ink"}`}>{money(fortieth)}</span>
                <span className="block text-xs text-muted">
                  {t(
                    `at ${f.num(adv.oneInForty, 0)}¢/bu; each tail rests on about ${f.num(h.tail_obs_95, 1)} past errors${weak ? ", so read it as a rough guide" : ""}`,
                    `a ${f.num(adv.oneInForty, 0)}¢/bu; cada cauda se apoia em cerca de ${f.num(h.tail_obs_95, 1)} erros passados${weak ? ", então use só como referência" : ""}`,
                  )}
                </span>
              </p>
              {pos && (
                <p className="text-xs text-ink-2" data-testid="target-pos">
                  {positionText(pos)}.
                </p>
              )}
              <div className="mt-auto pt-1">
                <Strip
                  pts={prof}
                  lo={lo}
                  hi={hi}
                  adverseLevel={producer ? 0.1 : 0.9}
                  label={t("Gain or loss at each 5% step of the range", "Ganho ou perda em cada passo de 5% da faixa")}
                />
                <p className="tabular flex justify-between text-[0.7rem] text-muted" data-testid="strip-scale">
                  <span>{money(lo)}</span>
                  <span>{money(hi)}</span>
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <ChartData
        testId="decision-data"
        caption={t("Gain or loss vs today at each percentile, by horizon", "Ganho ou perda contra hoje em cada percentil, por horizonte")}
        columns={[t("Percentile", "Percentil"), ...rows.map(({ h }) => f.horizon(h.h))]}
        rows={(rows[0]?.prof ?? [])
          .map((_, i) => [
            `p${Math.round((rows[0].prof[i].level ?? 0) * 100)}`,
            ...rows.map(({ prof }) => money(prof[i]?.pnl ?? 0)),
          ])
          .sort((a, b) => Number(String(a[0]).slice(1)) - Number(String(b[0]).slice(1)))}
      />

      <p className="text-xs leading-relaxed text-muted" data-testid="decision-footnote">
        {t(
          <>
            Illustrative and range-based, not VaR: CBOT only, excl. premium, with the exchange rate held fixed, so the basis is unhedged and
            the figures ignore freight, margin calls and contract rolls. The tail flag compares the misses on your side of the 80% range with
            the 10% each tail should have. No expected shortfall is shown, because each 95% tail rests on one or two of{" "}
            {horizons[0]?.calibration_n} overlapping past errors. The target readout is where your price sits within the tested range, not a
            chance of reaching it, because the ranges are not a price call.
            {rolls.length > 0
              ? ` Prices are the continuous front month and ${
                  everyRolls ? "every horizon crosses" : `the ${rolls.join(" and ")} ${rolls.length > 1 ? "horizons cross" : "horizon crosses"}`
                } a contract roll, so part of the move is a calendar spread that a hedge in today's front contract would not capture.`
              : ""}
          </>,
          <>
            Ilustrativo e baseado em faixas, não é VaR: só CBOT, sem prêmio, com câmbio fixo, então a base fica sem hedge e os números ignoram
            frete, chamadas de margem e rolagens de contrato. O alerta de cauda compara os erros do seu lado da faixa de 80% com os 10% que
            cada cauda deveria ter. Não mostramos expected shortfall, porque cada cauda de 95% se apoia em um ou dois dos{" "}
            {horizons[0]?.calibration_n} erros passados sobrepostos. A leitura do alvo mostra onde o seu preço fica dentro da faixa testada,
            não a chance de atingi-lo, porque as faixas não são uma aposta de preço.
            {rolls.length > 0
              ? ` Os preços são do primeiro vencimento contínuo e ${
                  everyRolls ? "todos os horizontes cruzam" : `${rolls.length > 1 ? "os horizontes de" : "o horizonte de"} ${rolls.join(" e ")} ${rolls.length > 1 ? "cruzam" : "cruza"}`
                } uma rolagem de contrato, então parte do movimento é um spread entre vencimentos que um hedge no contrato de hoje não capturaria.`
              : ""}
          </>,
        )}
      </p>
    </section>
  );
}
