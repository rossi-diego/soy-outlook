"use client";

import { useState } from "react";

import ChartData from "@/components/ChartData";
import RadioGroup from "@/components/RadioGroup";
import { adverse, type Currency, moneyAmount, parseTonnes, pnlVsToday, profile, type Side } from "@/lib/decision";
import type { Horizon } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Props = { horizons: Horizon[]; p0: number; buPerT: number; fx: number };

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

export default function DecisionPanel({ horizons, p0, buPerT, fx }: Props) {
  const { t, f, loc } = useI18n();
  const [side, setSide] = useState<Side>("producer");
  const [currency, setCurrency] = useState<Currency>("usd");
  const [hedgePct, setHedgePct] = useState(0);
  const [tonnes, setTonnes] = useState(1000);
  const [tonnesText, setTonnesText] = useState<string | null>(null);
  const [tonnesError, setTonnesError] = useState<string | null>(null);
  const tonnesShown = tonnesText ?? f.num(tonnes);
  const commitTonnes = () => {
    const r = parseTonnes(tonnesShown, loc);
    if (r.ok) {
      setTonnes(r.value);
      setTonnesText(null);
      setTonnesError(null);
    } else setTonnesError(r.error);
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
  const open = tonnes * (1 - hedgePct / 100);
  const everyRolls = rolls.length === horizons.length;

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
            `What the tested ranges above would mean for your volume if CBOT ended at their adverse end: the 1-in-10 level (${
              producer ? "10th percentile, prices lower" : "90th percentile, prices higher"
            }) and a rough 1-in-40 level. Hedged tonnes are treated as locked at today's close of ${f.num(p0, 0)}¢/bu.`,
            `O que as faixas testadas acima significariam para o seu volume se a CBOT terminasse na ponta desfavorável: o nível de 1 em 10 (${
              producer ? "percentil 10, preços mais baixos" : "percentil 90, preços mais altos"
            }) e um nível aproximado de 1 em 40. As toneladas com hedge são tratadas como travadas no fechamento de hoje, ${f.num(p0, 0)}¢/bu.`,
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
        <div className="w-40 space-y-1">
          <label htmlFor="tonnes" className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("Tonnes", "Toneladas")}
          </label>
          <input
            id="tonnes"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={tonnesShown}
            onChange={(e) => setTonnesText(e.target.value)}
            onBlur={commitTonnes}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTonnes();
            }}
            aria-invalid={tonnesError !== null}
            aria-describedby="tonnes-help"
            className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${tonnesError ? "border-warn-line" : "border-line"}`}
          />
          <p id="tonnes-help" className={`text-xs ${tonnesError ? "font-medium text-warn" : "text-muted"}`} role={tonnesError ? "alert" : undefined}>
            {tonnesError ? `${tonnesError} ${t("Using", "Usando")} ${f.num(tonnes)}.` : t("Physical volume exposed", "Volume físico exposto")}
          </p>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor="hedge" className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted">
            <span>{t("Hedge ratio", "Percentual com hedge")}</span>
            <span className="tabular normal-case text-ink" data-testid="hedge-value">
              {hedgePct}% {t("hedged", "com hedge")} · {f.num(open)} t {t("open", "em aberto")}
            </span>
          </label>
          <input
            id="hedge"
            type="range"
            min={0}
            max={100}
            step={5}
            value={hedgePct}
            aria-valuetext={t(`${hedgePct}% hedged, ${f.num(open)} tonnes open`, `${hedgePct}% com hedge, ${f.num(open)} toneladas em aberto`)}
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
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {rows.map(({ h, adv, prof }) => {
          const cov = h.coverage;
          const tenth = pnlVsToday(adv.oneInTen, p0, x);
          const fortieth = pnlVsToday(adv.oneInForty, p0, x);
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
              {cov.warn80 && (
                <p className="text-xs font-medium text-warn" data-testid="decision-warn">
                  <Tag
                    warn
                    title={t(
                      "Validation hit rate more than 5 percentage points below the nominal 80%",
                      "Taxa de acerto na validação mais de 5 pontos percentuais abaixo dos 80% nominais",
                    )}
                  >
                    {t("below 80%", "abaixo de 80%")}
                  </Tag>{" "}
                  {t(
                    `80% range ${f.held(cov, "80")}: this downside is likely understated.`,
                    `Faixa de 80%: ${f.held(cov, "80")}; esta perda provavelmente está subestimada.`,
                  )}
                </p>
              )}
              <p className="text-sm text-ink-2" data-testid="downside40">
                {t("Rough 1 in 40:", "Aprox. 1 em 40:")} <span className="tabular font-medium text-ink">{money(fortieth)}</span>
                <span className="block text-xs text-muted">
                  {t(
                    `at ${f.num(adv.oneInForty, 0)}¢/bu; each tail rests on about ${f.num(h.tail_obs_95, 1)} past errors${
                      cov.warn95 ? `, and the 95% range ${f.held(cov, "95")}` : ""
                    }`,
                    `a ${f.num(adv.oneInForty, 0)}¢/bu; cada cauda se apoia em cerca de ${f.num(h.tail_obs_95, 1)} erros passados${
                      cov.warn95 ? `, e a faixa de 95% ${f.held(cov, "95")}` : ""
                    }`,
                  )}
                </span>
              </p>
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
            Each dot is one 5% step of the range (5th to 95th percentile), on one scale for all three horizons; the ringed dot
            is the 1-in-10 level, the vertical line is {vs} today, and the end labels are the shared scale&apos;s limits.
            Illustrative and range-based, not VaR: CBOT only, excl. premium, with the exchange rate held fixed, so the basis
            is unhedged and the figures ignore freight, margin calls and contract rolls. No expected shortfall is shown,
            because each 95% tail rests on one or two of {horizons[0]?.calibration_n} overlapping past errors; and no chance
            of reaching a target price, because the ranges are not a price call.
            {rolls.length > 0
              ? ` Prices are the continuous front month and ${
                  everyRolls ? "every horizon crosses" : `the ${rolls.join(" and ")} ${rolls.length > 1 ? "horizons cross" : "horizon crosses"}`
                } a contract roll, so part of the move is a calendar spread that a hedge in today's front contract would not capture.`
              : ""}
          </>,
          <>
            Cada ponto é um passo de 5% da faixa (do percentil 5 ao 95), numa escala única para os três horizontes; o ponto
            com anel é o nível de 1 em 10, a linha vertical é {vs} hoje e os rótulos das pontas são os limites da escala
            comum. Ilustrativo e baseado em faixas, não é VaR: só CBOT, sem prêmio, com câmbio fixo, então a base fica sem
            hedge e os números ignoram frete, chamadas de margem e rolagens de contrato. Não mostramos expected shortfall,
            porque cada cauda de 95% se apoia em um ou dois dos {horizons[0]?.calibration_n} erros passados sobrepostos; nem
            a chance de atingir um preço-alvo, porque as faixas não são uma aposta de preço.
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
