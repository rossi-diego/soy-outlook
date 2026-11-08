"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import Chart from "@/components/Chart";
import ChartData from "@/components/ChartData";
import DecisionPanel from "@/components/DecisionPanel";
import RadioGroup from "@/components/RadioGroup";
import StressReplay from "@/components/StressReplay";
import { axisCommon, baseOption, isNarrow, type Tokens } from "@/lib/chart";
import { type Assumptions, convert, decimalsFor, parseBasis, parseFx, premiumUsdT, type Unit } from "@/lib/format";
import { parsePremium, premiumInputText, usePremium } from "@/lib/premium";
import type { Horizon, Meta, Outlook } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Props = { meta: Meta; outlook: Outlook };
type T = <V>(en: V, pt: V) => V;

/** Small word badge; the amber tone always comes with text, never colour alone. */
function Badge({ children, title, warn = false }: { children: React.ReactNode; title?: string; warn?: boolean }) {
  return (
    <span
      title={title}
      className={`ml-1.5 inline-block rounded-full border px-1.5 py-px align-middle text-[0.7rem] font-medium leading-4 ${
        warn ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

function HorizonCard({
  h,
  unit,
  a,
  origin,
  local,
  fob,
}: {
  h: Horizon;
  unit: Unit;
  a: Assumptions;
  origin: string;
  /** A port-to-interior discount is applied: the R$ value is an estimate at the user's location. */
  local: boolean;
  /** The user entered a premium, so USD/t and R$/sack are FOB; otherwise they are CBOT only. */
  fob: boolean;
}) {
  const { t, f } = useI18n();
  const c = (v: number) => convert(v, unit, a);
  const isRw = h.model === "rw";
  const cov = h.coverage;
  const usdT = (v: number) => premiumUsdT(v, a.buPerT);
  const ci80 = f.ci(cov.validation, "80");
  const ci95 = f.ci(cov.validation, "95", false);
  const ct = h.contract;
  const dec = decimalsFor(unit);
  return (
    <article className="card flex flex-col gap-3 p-5" data-testid={`horizon-${h.h}`}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-2">
          {t("In", "Em")} {f.horizon(h.h)}
        </h3>
        <span className="text-xs text-muted">{f.date(h.target_date)}</span>
      </header>
      <div>
        <p className={`text-xs ${cov.warn80 ? "font-medium text-warn" : "text-muted"}`} data-testid="label80">
          {f.range(cov, "80")}, {f.unit(unit)}
          {cov.warn80 && (
            <Badge
              warn
              title={t(
                "Validation hit rate more than 5 percentage points below the nominal 80%",
                "Taxa de acerto na validação mais de 5 pontos percentuais abaixo dos 80% nominais",
              )}
            >
              {t("below 80%", "abaixo de 80%")}
            </Badge>
          )}
        </p>
        {ci80 && (
          <p className="text-xs text-muted" data-testid="ci80">
            {cov.validation?.years}: {ci80}
          </p>
        )}
        <p className="tabular text-2xl font-semibold tracking-tight">
          {f.num(c(h.q100), dec)} – {f.num(c(h.q900), dec)}
        </p>
        {unit !== "c_bu" && (
          <p className="mt-0.5 text-xs text-muted" data-testid="basis-label">
            {basisNote(t, unit, fob)}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-2">{t("Central", "Central")}</dt>
        <dd className="tabular text-right">
          {f.money(c(h.central), unit)}
          {isRw && <span className="ml-1 text-xs text-muted">{t("(CBOT unchanged)", "(CBOT sem variação)")}</span>}
        </dd>
        <dt className="text-ink-2">{t("95% range", "Faixa de 95%")}</dt>
        <dd className="tabular text-right text-ink-2">
          {f.num(c(h.q025), dec)} – {f.num(c(h.q975), dec)}
          <span className={`block text-xs ${cov.warn95 ? "text-warn" : "text-muted"}`} data-testid="held95">
            {f.held(cov, "95")}
          </span>
          {ci95 && (
            <span className="block text-xs text-muted" data-testid="ci95">
              {ci95}
            </span>
          )}
          {cov.warn95 && (
            <Badge
              warn
              title={t(
                "Validation hit rate more than 5 percentage points below the nominal 95%",
                "Taxa de acerto na validação mais de 5 pontos percentuais abaixo dos 95% nominais",
              )}
            >
              {t("below 95%", "abaixo de 95%")}
            </Badge>
          )}
        </dd>
        <dt className="text-ink-2">{t("Hedge contract", "Contrato de hedge")}</dt>
        <dd className="tabular text-right" data-testid="contract">
          {ct.reference.code}
          {ct.crosses_roll && (
            <Badge
              title={t(
                "The continuous front-month price rolls to another contract inside this window, so part of the move is a calendar spread",
                "O preço contínuo do primeiro vencimento troca de contrato dentro desta janela, então parte do movimento é um spread entre vencimentos",
              )}
            >
              {t("crosses a roll", "cruza uma rolagem")}
            </Badge>
          )}
          <span className="block text-xs text-muted">
            {ct.crosses_roll
              ? `${t("price series rolls", "a série de preços passa de")} ${ct.front_at_origin} → ${ct.front_at_target}${
                  ct.crosses_crop_roll ? t(", old to new crop", ", safra velha para safra nova") : ""
                }`
              : `${t("price series stays on", "a série de preços fica em")} ${ct.front_at_origin}`}
          </span>
        </dd>
        {unit !== "c_bu" && fob && (
          <>
            <dt className="text-ink-2">{t("Your premium", "Seu prêmio")}</dt>
            <dd className="tabular text-right text-ink-2" data-testid="premium-row">
              {f.signed0(a.premium)}¢/bu
              <span className="block text-xs text-muted">
                {f.signed0(usdT(a.premium))} USD/t{t(", your input, held flat", ", informado por você, mantido constante")}
              </span>
            </dd>
            {unit === "brl_sack" && local && (
              <>
                <dt className="text-ink-2">{t("Your discount", "Seu desconto")}</dt>
                <dd className="tabular text-right text-ink-2" data-testid="basis-row">
                  −R$ {f.num(a.basis ?? 0, 2)}/sc
                  <span className="block text-xs text-muted">{t("your input, not a sourced value", "informado por você, não é dado de fonte")}</span>
                </dd>
              </>
            )}
          </>
        )}
      </dl>
      {unit !== "c_bu" && fob && <p className="text-xs leading-relaxed text-ink-2">{fobBridge(t)}</p>}
      <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-muted">
        {t(
          <>
            Hit rates on {cov.validation?.n ?? "—"} validation and {cov.holdout?.n ?? "—"} later reports. Each 95% tail rests on
            about {f.num(h.tail_obs_95, 1)} of the {h.calibration_n} past errors behind the range (about{" "}
            {f.num(h.calibration_n_eff, 0)} non-overlapping).
          </>,
          <>
            Taxas de acerto em {cov.validation?.n ?? "—"} relatórios de validação e {cov.holdout?.n ?? "—"} posteriores. Cada cauda
            de 95% se apoia em cerca de {f.num(h.tail_obs_95, 1)} dos {h.calibration_n} erros passados por trás da faixa (cerca de{" "}
            {f.num(h.calibration_n_eff, 0)} sem sobreposição).
          </>,
        )}{" "}
        {origin}
      </p>
    </article>
  );
}

// P1 phase 1: the band is CBOT risk only; premium and FX uncertainty are not in it. With no
// premium entered (no premium data ships with the site), USD/t and R$/sack are CBOT alone.
const basisNote = (t: T, unit: Unit, fob: boolean) =>
  fob
    ? unit === "brl_sack"
      ? t("CBOT price risk only; your premium and BRL held fixed", "Só o risco de preço da CBOT; seu prêmio e câmbio fixos")
      : t("CBOT price risk only; your premium held fixed", "Só o risco de preço da CBOT; seu prêmio fixo")
    : unit === "brl_sack"
      ? t("CBOT only, excl. premium; BRL held fixed", "Só CBOT, sem prêmio; câmbio fixo")
      : t("CBOT only, excl. premium", "Só CBOT, sem prêmio");
const fobBridge = (t: T) =>
  t(
    "FOB = CBOT + your premium; CBOT unchanged, FOB changes only through the premium you enter.",
    "FOB = CBOT + o seu prêmio; com a CBOT sem variação, o FOB só muda pelo prêmio que você informar.",
  );

// P15: how far the live forecast is from the release-day origins the ranges were tested on.
const issuedLabel = (t: T, month: string, days: number) =>
  days <= 0
    ? t(`Issued on the ${month} WASDE release day`, `Emitida no dia de divulgação do WASDE de ${month}`)
    : t(
        `Issued from the ${month} WASDE, ${days} day${days === 1 ? "" : "s"} after its release`,
        `Emitida a partir do WASDE de ${month}, ${days} dia${days === 1 ? "" : "s"} após a divulgação`,
      );

type HistSpan = "18m" | "3y";
const HIST_MONTHS: Record<HistSpan, number> = { "18m": 18, "3y": 36 };

function useUnitOptions(fob: boolean): { id: Unit; label: string; short: string }[] {
  const { t } = useI18n();
  // Short labels on phones (P27) are a substring of the full name, which stays the accessible name.
  // USD/t and R$/sack are FOB only once the user enters a premium; until then they are CBOT only.
  const basis = fob ? "FOB" : "CBOT";
  return [
    { id: "usd_t", label: `${basis} USD/t`, short: "USD/t" },
    { id: "brl_sack", label: t(`${basis} R$/sack`, `${basis} R$/saca`), short: t("R$/sack", "R$/saca") },
    { id: "c_bu", label: "CBOT ¢/bu", short: "¢/bu" },
  ];
}

export default function OutlookView({ meta, outlook }: Props) {
  const { t, f, d, pt } = useI18n();
  // R$/sack is the default unit only under pt-BR (P20); an explicit choice wins in either locale.
  const [unitChoice, setUnitChoice] = useState<Unit | null>(null);
  const unit: Unit = unitChoice ?? (pt ? "brl_sack" : "usd_t");
  // The premium is the user's input only: empty by default, kept per viewer (lib/premium.ts).
  const [premiumInput, setPremiumInput] = usePremium();
  const fob = premiumInput !== null;
  const premium = premiumInput ?? 0;
  const unitOptions = useUnitOptions(fob);
  const [premiumText, setPremiumText] = useState<string | null>(null);
  const [premiumError, setPremiumError] = useState<string | null>(null);
  const premiumShown = premiumText ?? premiumInputText(premiumInput, f.loc);
  const commitPremium = (text: string = premiumShown) => {
    const r = parsePremium(text, f.loc);
    if (r.ok) {
      setPremiumInput(r.value);
      setPremiumText(null);
      setPremiumError(null);
    } else setPremiumError(r.error);
  };
  const fxDefault = Math.round(meta.fx_default.value * 100) / 100;
  // FX is typed as text and parsed on blur, so a half-typed "5," never snaps back to the default.
  const [fx, setFx] = useState<number>(fxDefault);
  const [fxText, setFxText] = useState<string | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const fxShown = fxText ?? f.num(fx, 2);
  const commitFx = () => {
    const r = parseFx(fxShown, f.loc);
    if (r.ok) {
      setFx(r.value);
      setFxText(null);
      setFxError(null);
    } else setFxError(r.error);
  };
  // P20: optional port-to-interior discount, R$/sack, user-supplied, default 0 (no regional defaults).
  const [basis, setBasis] = useState(0);
  const [basisText, setBasisText] = useState("");
  const [basisError, setBasisError] = useState<string | null>(null);
  const commitBasis = () => {
    const r = parseBasis(basisText, f.loc);
    if (r.ok) {
      setBasis(r.value);
      setBasisText(r.value === 0 ? "" : f.num(r.value, 2));
      setBasisError(null);
    } else setBasisError(r.error);
  };
  const [span, setSpan] = useState<HistSpan>("18m");
  const [chartView, setChartView] = useState<"cbot" | "fob">("cbot");

  const last = outlook.last.c_bu;
  // The port-to-interior discount only makes sense on a FOB price, so it needs a premium too.
  const basisOn = unit === "brl_sack" && fob;
  const local = basisOn && basis > 0;
  const base = { fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg, basis: basisOn ? basis : 0 };
  // One premium for the headline and every horizon: with CBOT unchanged, FOB is unchanged.
  const championAllRw = outlook.horizons.every((h) => h.model === "rw");
  const h3 = outlook.horizons.find((h) => h.h === 3) ?? outlook.horizons[0];
  const todayA: Assumptions = { ...base, premium };
  const issued = issuedLabel(t, f.monthAbbr(Number(meta.latest_wasde.month.slice(5, 7))), meta.days_since_report);
  const originNote = `${issued}${t("; ranges are calibrated at release-day closes.", "; as faixas são calibradas nos fechamentos dos dias de divulgação.")}`;
  const fobWord = local ? t("est. local price", "preço estimado na sua praça") : "FOB";

  // Chart (P21): CBOT ¢/bu by default. The FOB view is the same picture shifted by the one flat
  // premium the user typed (and scaled by FX for R$/sack): a constant shift, never a historical
  // FOB series. Without a premium there is no FOB view.
  const fobView = chartView === "fob" && unit !== "c_bu" && fob;
  const chartUnit: Unit = fobView ? unit : "c_bu";
  const chartA: Assumptions = { premium: fobView ? premium : 0, fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg, basis: fobView ? base.basis : 0 };
  const option = useCallback(
    (tk: Tokens) => {
      const dec = decimalsFor(chartUnit);
      const cv = (v: number) => Math.round(convert(v, chartUnit, chartA) * 100) / 100;
      const cutoff = new Date(outlook.as_of_close + "T00:00:00Z");
      cutoff.setUTCMonth(cutoff.getUTCMonth() - HIST_MONTHS[span]);
      const hist: [string, number][] = outlook.history
        .filter((p) => new Date(p.date + "T00:00:00Z") >= cutoff)
        .map((p) => [p.date, cv(p.c_bu)]);
      if (hist.length === 0 || hist[hist.length - 1][0] !== outlook.as_of_close) hist.push([outlook.as_of_close, cv(last)]);
      const hs = outlook.horizons;
      const whisker = (hh: Horizon, lo: number, hi: number, level: "80" | "95") => ({
        name: `${level}% range ${hh.h}m`,
        type: "line",
        data: [
          [hh.target_date, cv(lo)],
          [hh.target_date, cv(hi)],
        ],
        symbol: "none",
        silent: true,
        tooltip: { show: false },
        z: level === "80" ? 3 : 2,
        lineStyle:
          level === "80"
            ? { color: hh.coverage.warn80 ? tk.warn : tk.series1, width: 7, opacity: 0.38, cap: "round" }
            : { color: hh.coverage.warn95 ? tk.warn : tk.series1, width: 1.5, opacity: 0.75, type: "dashed" },
      });
      // Today and the next WASDE are days apart: labels sit above the plot, pushed apart horizontally.
      const lines: { xAxis: string; name: string; label: { align: "left" | "right"; padding: number[] } }[] = [
        { xAxis: outlook.as_of_close, name: t("today", "hoje"), label: { align: "right", padding: [0, 4, 0, 0] } },
      ];
      // Phones (P27): the label starts just right of "today", so it drops the year (the release
      // is days away) and Portuguese abbreviates "próximo", keeping it inside the chart.
      const narrow = isNarrow();
      if (meta.next_wasde && meta.next_wasde > outlook.as_of_close)
        lines.push({
          xAxis: meta.next_wasde,
          name: narrow
            ? `${t("next WASDE", "próx. WASDE")} ${f.date(meta.next_wasde).replace(/,?\s+\d{4}$/, "")}`
            : `${t("next WASDE", "próximo WASDE")} ${f.date(meta.next_wasde)}`,
          label: { align: "left", padding: [0, 0, 0, 4] },
        });
      const fm = (v: number) => f.num(v, dec);
      return {
        ...baseOption(tk),
        legend: { show: false },
        // The end label ("no change" / "sem variação") needs its width right of the plot.
        grid: { ...baseOption(tk).grid, right: t(64, 80), top: 48 },
        tooltip: {
          ...baseOption(tk).tooltip,
          trigger: "axis",
          formatter: (ps: { seriesName: string; dataIndex: number; value: [string, number] }[]) => {
            const fc = ps.find((p) => p.seriesName === "Forecast" && p.dataIndex > 0);
            if (fc) {
              const hh = hs[fc.dataIndex - 1];
              return [
                `<b>${t("In", "Em")} ${f.horizon(hh.h)}</b> · ${f.date(hh.target_date)}`,
                `${t("Central (no change)", "Central (sem variação)")}: ${fm(cv(hh.central))}`,
                `${t("80% range", "Faixa de 80%")}: ${fm(cv(hh.q100))} – ${fm(cv(hh.q900))}`,
                `${t("95% range", "Faixa de 95%")}: ${fm(cv(hh.q025))} – ${fm(cv(hh.q975))}`,
                `<span style="color:${tk.muted}">80% ${f.held(hh.coverage, "80")}</span>`,
              ].join("<br/>");
            }
            const c = ps.find((p) => p.seriesName === "Close");
            return c ? `${f.date(c.value[0])}<br/>${t("Close", "Fechamento")}: <b>${fm(c.value[1])}</b>` : "";
          },
        },
        xAxis: { type: "time", ...axisCommon(tk), splitLine: { show: false } },
        yAxis: {
          type: "value",
          scale: true,
          ...axisCommon(tk),
          axisLabel: { ...axisCommon(tk).axisLabel, formatter: (v: number) => f.num(v, 0) },
          name: f.unit(chartUnit),
          nameTextStyle: { color: tk.muted },
        },
        series: [
          ...hs.map((hh) => whisker(hh, hh.q025, hh.q975, "95")),
          ...hs.map((hh) => whisker(hh, hh.q100, hh.q900, "80")),
          {
            name: "Close",
            type: "line",
            data: hist,
            symbol: "none",
            lineStyle: { color: tk.ink, width: 1.5 },
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              lineStyle: { color: tk.axis, type: "solid", width: 1 },
              label: { color: tk.muted, fontSize: 11, position: "end", formatter: "{b}" },
              data: lines,
            },
          },
          {
            name: "Forecast",
            type: "line",
            data: [[outlook.as_of_close, cv(last)], ...hs.map((hh) => [hh.target_date, cv(hh.central)])],
            symbol: "circle",
            symbolSize: (_: unknown, p: { dataIndex: number }) => (p.dataIndex === 0 ? 0 : 8),
            itemStyle: { color: tk.series1, borderColor: tk.surface, borderWidth: 1.5 },
            lineStyle: { color: tk.series1, type: "dashed", width: 1.5 },
            endLabel: { show: true, formatter: t("no change", "sem variação"), color: tk.series1, fontSize: 11, distance: 6 },
            z: 4,
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartUnit, fobView, premium, fx, span, outlook, last, meta.consts.bu_per_t, meta.consts.sack_kg, meta.next_wasde, f, base.basis],
  );

  const range = {
    lo: f.money(convert(h3.q100, unit, todayA), unit),
    hi: f.money(convert(h3.q900, unit, todayA), unit),
    date: f.date(h3.target_date),
  };
  const chartDec = decimalsFor(chartUnit);
  const cvTable = (v: number) => f.num(convert(v, chartUnit, chartA), chartDec);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">
          {t("After the", "Depois do WASDE de")} {f.month(meta.latest_wasde.month)}
          {t(" WASDE", "")} · {t("CBOT close", "fechamento CBOT")} {f.date(outlook.as_of_close)}
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {t(
            "Price-risk ranges for Brazilian export soybeans, 1 to 6 months ahead",
            "Faixas de risco de preço para a soja brasileira de exportação, de 1 a 6 meses à frente",
          )}
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-ink-2" data-testid="hero-framing">
          {t(
            "For budgeting and hedging: how far CBOT soybeans could move from today, in ranges labelled by the hit rate they actually achieved. A risk range, not a price call.",
            "Para orçamento e hedge: quanto a soja na CBOT pode se mover a partir de hoje, em faixas rotuladas com a taxa de acerto que de fato tiveram. Uma faixa de risco, não uma aposta de preço.",
          )}
        </p>
        <p className="max-w-3xl text-lg leading-relaxed text-ink-2" data-testid="headline">
          {unit === "c_bu" ? (
            <>
              {t("CBOT soybeans closed at", "A soja na CBOT fechou a")} <strong className="text-ink">{f.money(last, "c_bu")}</strong>.
            </>
          ) : !fob ? (
            <>
              {t("CBOT soybeans closed at", "A soja na CBOT fechou a")} <strong className="text-ink">{f.money(last, "c_bu")}</strong>{" "}
              = <strong className="text-ink">{f.money(convert(last, unit, todayA), unit)}</strong>
              {unit === "brl_sack" && (
                <span className="text-base">
                  {" "}
                  {t("at", "a")} {f.num(fx, 2)} BRL/USD
                </span>
              )}{" "}
              <span className="text-base">({t("CBOT only, excl. premium", "só CBOT, sem prêmio")})</span>.
            </>
          ) : (
            <>
              CBOT <strong className="text-ink">{f.money(last, "c_bu")}</strong> + {t("your premium", "seu prêmio")}{" "}
              <strong className="text-ink">{f.signed0(premium)}¢/bu</strong>
              {local && (
                <>
                  {" "}
                  − {t("your discount", "seu desconto")} <strong className="text-ink">R$ {f.num(basis, 2)}/sc</strong>
                </>
              )}{" "}
              = {fobWord} <strong className="text-ink">{f.money(convert(last, unit, todayA), unit)}</strong>
              {unit === "brl_sack" && (
                <span className="text-base">
                  {" "}
                  {t("at", "a")} {f.num(fx, 2)} BRL/USD
                </span>
              )}
              .
            </>
          )}{" "}
          {t(`By ${range.date}, the 3-month`, `Até ${range.date}, no horizonte de 3 meses, a`)}{" "}
          <span className={h3.coverage.warn80 ? "text-warn" : undefined} data-testid="hero-range-label">
            {f.range(h3.coverage, "80")}
          </span>{" "}
          {t("is", "vai de")} <strong className="text-ink">{range.lo}</strong> {t("to", "a")}{" "}
          <strong className="text-ink">{range.hi}</strong>
          {unit !== "c_bu" && fob && <span className="text-base"> ({basisNote(t, unit, fob)})</span>}.
        </p>
        <p className="max-w-3xl text-sm text-muted">
          {issued}.{" "}
          {t(
            `The ranges are calibrated on forecasts made at the close of WASDE release days, so treat them as approximate ${
              meta.days_since_report > 0 ? "this far from one" : "between reports"
            }.`,
            `As faixas são calibradas em previsões feitas no fechamento dos dias de divulgação do WASDE; trate-as como aproximadas ${
              meta.days_since_report > 0 ? "a esta distância de um deles" : "entre relatórios"
            }.`,
          )}
        </p>
      </section>

      {championAllRw && (
        <aside className="card border-l-4 p-4 text-sm leading-relaxed text-ink-2" style={{ borderLeftColor: "var(--accent)" }}>
          {t(
            <>
              <strong className="text-ink">No reliable direction signal.</strong> Tested on every WASDE since{" "}
              <span data-testid="validation-start">{meta.splits.validation[0].slice(0, 4)}</span>, no model (including one
              built on WASDE revisions) predicted CBOT soybeans better than &ldquo;no change&rdquo;. So the central line is
              today&apos;s price, and what this page adds is a <em>tested range</em> labelled with the hit rate it actually
              achieved.{" "}
              <Link className="underline hover:text-ink" href="/track-record/">
                See the track record
              </Link>
              .
            </>,
            <>
              <strong className="text-ink">Nenhum sinal confiável de direção.</strong> Testado em todos os WASDE desde{" "}
              <span data-testid="validation-start">{meta.splits.validation[0].slice(0, 4)}</span>, nenhum modelo (nem um
              construído com as revisões do WASDE) previu a soja na CBOT melhor do que &ldquo;sem variação&rdquo;. Por isso a
              linha central é o preço de hoje, e o que esta página acrescenta é uma <em>faixa testada</em>, rotulada com a
              taxa de acerto que ela de fato teve.{" "}
              <Link className="underline hover:text-ink" href="/track-record/">
                Veja o histórico
              </Link>
              .
            </>,
          )}
        </aside>
      )}

      <section className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted" id="unit-legend">
            {t("Show prices as", "Mostrar preços em")}
          </p>
          <RadioGroup legend={t("Price unit", "Unidade de preço")} value={unit} onChange={setUnitChoice} options={unitOptions} />
        </div>
        {unit !== "c_bu" && (
          <div className="w-full max-w-sm space-y-1 sm:w-72" data-testid="premium-input">
            <label htmlFor="premium" className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("Paranaguá premium, ¢/bu (optional)", "Prêmio de Paranaguá, ¢/bu (opcional)")}
            </label>
            <div className="flex gap-2">
              <input
                id="premium"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder={t("e.g. 80 or -12", "ex.: 80 ou -12")}
                value={premiumShown}
                onChange={(e) => setPremiumText(e.target.value)}
                onBlur={() => commitPremium()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitPremium();
                }}
                aria-invalid={premiumError !== null}
                aria-describedby="premium-help"
                className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${premiumError ? "border-warn-line" : "border-line"}`}
              />
              {fob && (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                  onClick={() => commitPremium("")}
                >
                  {t("Clear", "Limpar")}
                </button>
              )}
            </div>
            <p
              id="premium-help"
              className={`text-xs ${premiumError ? "font-medium text-warn" : "text-muted"}`}
              role={premiumError ? "alert" : undefined}
              data-testid="premium-help"
            >
              {premiumError
                ? `${premiumError} ${
                    fob
                      ? t(`Using ${f.signed0(premium)}¢/bu.`, `Usando ${f.signed0(premium)}¢/bu.`)
                      : t("Showing CBOT only.", "Mostrando só CBOT.")
                  }`
                : t(
                    "Enter your broker's Paranaguá premium in ¢/bu vs the named CBOT contract. Empty = CBOT only; kept in this browser only.",
                    "Informe o prêmio de Paranaguá do seu corretor em ¢/bu sobre o contrato CBOT indicado. Vazio = só CBOT; fica salvo só neste navegador.",
                  )}
            </p>
          </div>
        )}
        {unit === "brl_sack" && (
          <div className="w-44 space-y-1">
            <label htmlFor="fx" className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("BRL per USD", "Reais por dólar")}
            </label>
            <input
              id="fx"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fxShown}
              onChange={(e) => setFxText(e.target.value)}
              onBlur={commitFx}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitFx();
              }}
              aria-invalid={fxError !== null}
              aria-describedby="fx-help"
              className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${fxError ? "border-warn-line" : "border-line"}`}
            />
            {fxError ? (
              <p id="fx-help" className="text-xs font-medium text-warn" role="alert" data-testid="fx-error">
                {fxError} {t("Using", "Usando")} {f.num(fx, 2)}.
              </p>
            ) : (
              <p id="fx-help" className="text-xs text-muted">
                PTAX {f.date(meta.fx_default.date)}: {f.num(meta.fx_default.value, 4)}
              </p>
            )}
          </div>
        )}
        {basisOn && (
          <div className="w-full max-w-sm space-y-1 sm:w-64">
            <label htmlFor="basis" className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("Port-to-interior discount (R$/sack)", "Desconto porto-interior (R$/sc)")}
            </label>
            <input
              id="basis"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={basisText}
              onChange={(e) => setBasisText(e.target.value)}
              onBlur={commitBasis}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitBasis();
              }}
              aria-invalid={basisError !== null}
              aria-describedby="basis-help"
              className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${basisError ? "border-warn-line" : "border-line"}`}
            />
            <p id="basis-help" className={`text-xs ${basisError ? "font-medium text-warn" : "text-muted"}`} role={basisError ? "alert" : undefined}>
              {basisError
                ? `${basisError} ${t("Using", "Usando")} ${f.num(basis, 2)}.`
                : t(
                    "Optional, your own number (freight, fobbing and local discount); there is no sourced regional default. 0 = port FOB.",
                    "Opcional, número seu (frete, fobbing e desconto local); não há padrão regional com fonte. 0 = FOB no porto.",
                  )}
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label={t("Forecast by horizon", "Previsão por horizonte")}>
        {outlook.horizons.map((h) => (
          <HorizonCard key={h.h} h={h} unit={unit} a={todayA} origin={originNote} local={local} fob={fob} />
        ))}
      </section>

      <DecisionPanel horizons={outlook.horizons} p0={last} buPerT={meta.consts.bu_per_t} fx={fx} />

      <section className="card space-y-3 p-5" data-testid="hero-chart">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {fobView ? t("FOB view", "Visão FOB") : t("CBOT soybeans", "Soja na CBOT")}
            {t(": recent closes and the tested ranges ahead", ": fechamentos recentes e as faixas testadas à frente")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {unit !== "c_bu" && fob && (
              <RadioGroup
                size="sm"
                legend={t("Chart unit", "Unidade do gráfico")}
                value={chartView}
                onChange={setChartView}
                options={[
                  { id: "cbot", label: "CBOT" },
                  { id: "fob", label: t("FOB shift", "Deslocamento FOB") },
                ]}
              />
            )}
            <RadioGroup
              size="sm"
              legend={t("History shown", "Histórico exibido")}
              value={span}
              onChange={setSpan}
              options={[
                { id: "18m", label: t("18 months", "18 meses") },
                { id: "3y", label: t("3 years", "3 anos") },
              ]}
            />
          </div>
        </div>
        <Chart
          option={option}
          height={360}
          ariaLabel={t(
            "CBOT soybean closes with the 80% and 95% forecast ranges at 1, 3 and 6 months as whiskers",
            "Fechamentos da soja na CBOT com as faixas de previsão de 80% e 95% em 1, 3 e 6 meses",
          )}
        />
        <ChartData
          testId="hero-chart-data"
          caption={t("Forecast ranges by horizon", "Faixas de previsão por horizonte")}
          columns={[
            t("Horizon", "Horizonte"),
            t("Target date", "Data-alvo"),
            `${t("Central", "Central")}, ${f.unit(chartUnit)}`,
            t("80% range", "Faixa de 80%"),
            t("95% range", "Faixa de 95%"),
            t("80% held (validation)", "Acerto 80% (validação)"),
          ]}
          rows={[
            [t("Today", "Hoje"), f.date(outlook.as_of_close), cvTable(last), "—", "—", "—"],
            ...outlook.horizons.map((hh) => [
              f.horizon(hh.h),
              f.date(hh.target_date),
              cvTable(hh.central),
              `${cvTable(hh.q100)} – ${cvTable(hh.q900)}`,
              `${cvTable(hh.q025)} – ${cvTable(hh.q975)}`,
              f.pct(hh.coverage.validation?.cover80),
            ]),
          ]}
        />
        <p className="text-xs leading-relaxed text-muted" data-testid="chart-caption">
          {fobView ? (
            t(
              <>
                <strong className="font-medium text-ink-2">FOB view, constant shift:</strong> every point, past and future, is
                CBOT + the one flat premium you set ({f.signed0(premium)}¢/bu)
                {unit === "brl_sack" ? `, converted at ${f.num(fx, 2)} BRL/USD` : ""}
                {local ? `, minus your R$ ${f.num(basis, 2)}/sack discount` : ""}. It is not a historical FOB series, and the
                ranges still cover CBOT moves only.{" "}
              </>,
              <>
                <strong className="font-medium text-ink-2">Visão FOB, deslocamento constante:</strong> cada ponto, passado e
                futuro, é a CBOT + o único prêmio constante que você definiu ({f.signed0(premium)}¢/bu)
                {unit === "brl_sack" ? `, convertido a ${f.num(fx, 2)} BRL/USD` : ""}
                {local ? `, menos o seu desconto de R$ ${f.num(basis, 2)}/sc` : ""}. Não é uma série histórica de FOB, e as
                faixas continuam cobrindo só os movimentos da CBOT.{" "}
              </>,
            )
          ) : (
            <>
              <strong className="font-medium text-ink-2">{f.unitLong("c_bu")}</strong>
              {t(", before any premium or exchange rate. ", ", antes de qualquer prêmio ou câmbio. ")}
            </>
          )}
          {t(
            <>
              Whiskers at 1, 3 and 6 months: thick = nominal 80% range, thin dashed = nominal 95% range, whose tails rest on
              one or two past errors each, so read it as rough; amber marks a range that held more than 5 points below its
              nominal level. The dashed &ldquo;no change&rdquo; line is the central forecast. Hover a whisker for its limits;
              the hit rate each range achieved is on the cards above. Ranges come from the errors of the last{" "}
              {meta.calibration_window} out-of-sample forecasts. FOB is (CBOT + your premium) × {f.num(meta.consts.bu_per_t, 4)}{" "}
              bu/t ÷ 100; with no premium entered, USD/t and R$/sack are the CBOT price alone. Reais per sack use your
              exchange rate; with a premium they are port FOB (which includes fobbing, the port loading cost), not a farm-gate
              price.
            </>,
            <>
              Marcas em 1, 3 e 6 meses: grossa = faixa nominal de 80%, fina tracejada = faixa nominal de 95%, cujas caudas se
              apoiam em um ou dois erros passados cada, então leia-a como aproximada; âmbar marca uma faixa que acertou mais de
              5 pontos abaixo do seu nível nominal. A linha tracejada &ldquo;sem variação&rdquo; é a previsão central. Passe o
              cursor sobre uma marca para ver os limites; a taxa de acerto de cada faixa está nos cartões acima. As faixas vêm
              dos erros das últimas {meta.calibration_window} previsões fora da amostra. FOB = (CBOT + o seu prêmio) ×{" "}
              {f.num(meta.consts.bu_per_t, 4)} bu/t ÷ 100; sem prêmio informado, USD/t e R$/saca são só o preço da CBOT. Reais
              por saca usam o seu câmbio; com prêmio, são valor FOB no porto (que inclui o fobbing, custo de embarque no
              porto), não preço na fazenda.
            </>,
          )}
        </p>
      </section>

      <StressReplay stress={outlook.stress} buPerT={meta.consts.bu_per_t} />

      <section>
        <div className="card space-y-2 p-5 text-sm leading-relaxed text-ink-2">
          <h2 className="text-base font-semibold text-ink">{t("What the WASDE does", "O que o WASDE faz")}</h2>
          <p>
            {t(
              "Revisions move the price on release day, and after that they are priced in. The",
              "As revisões mexem no preço no dia da divulgação e, depois disso, já estão no preço. A",
            )}{" "}
            <Link className="underline hover:text-ink" href="/wasde/">
              {t("WASDE page", "página do WASDE")}
            </Link>{" "}
            {t(
              "shows the latest revisions and the historical average reaction to each one, with a calculator for your own what-ifs.",
              "mostra as últimas revisões e a reação média histórica a cada uma, com uma calculadora para as suas simulações.",
            )}{" "}
            {t("Next report:", "Próximo relatório:")}{" "}
            {meta.next_wasde ? f.date(meta.next_wasde, "long") : t("see USDA calendar", "veja o calendário do USDA")}.
          </p>
        </div>
      </section>
    </div>
  );
}

