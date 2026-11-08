"use client";

import { useCallback, useMemo, useState } from "react";

import Chart from "@/components/Chart";
import ChartData from "@/components/ChartData";
import RadioGroup from "@/components/RadioGroup";
import { axisCommon, timeAxisLabel, baseOption, type Tokens } from "@/lib/chart";
import type { Fmt } from "@/lib/format";
import { type Locale, TERMS } from "@/lib/i18n";
import { HORIZONS, isoDay, maeVsNoChange, PATH_MODELS, type SlimMetric, type TrackView } from "@/lib/trackView";
import type { ArchiveIndex, Meta, ModelId } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

const CHALLENGERS: ModelId[] = ["drift", "arima", "ridge"];
const HS: number[] = [...HORIZONS];

const SHORT_EN: Record<ModelId, string> = { rw: "No change", drift: "Average past change", arima: "ARIMA", ridge: "WASDE ridge" };
const SHORT_PT: Record<ModelId, string> = { rw: "Sem variação", drift: "Variação média passada", arima: "ARIMA", ridge: "Ridge WASDE" };
const short = (loc: Locale) => (loc === "pt-BR" ? SHORT_PT : SHORT_EN);

function Term({ k, children }: { k: keyof typeof TERMS; children: React.ReactNode }) {
  const { pt } = useI18n();
  return (
    <abbr className="term" title={pt ? TERMS[k].pt : TERMS[k].en} tabIndex={0}>
      {children}
    </abbr>
  );
}

function find(rows: SlimMetric[], split: string, model: ModelId, h: number) {
  return rows.find((r) => r.split === split && r.model === model && r.h === h);
}

const signedPctF = (f: Fmt) => (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${f.num(Math.abs(v), d)}%`;
const pFmtF = (f: Fmt) => (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v < 0.001 ? `<${f.num(0.001, 3)}` : f.num(v, 3);

function Outcome({ ok, label }: { ok: boolean | null; label: string }) {
  const { t } = useI18n();
  if (ok === null) return <span className="text-muted">—</span>;
  return (
    <span className={ok ? "text-ink" : "font-medium text-warn"}>
      {ok ? t("inside", "dentro") : t("outside", "fora")}
      <span className="sr-only"> {t(`the ${label} range`, `da faixa de ${label}`)}</span>
    </span>
  );
}

/** P4 breach strip: where the misses of the published 80% range fell, below vs above. */
function BreachStrip({ rows, years }: { rows: { h: number; lo: number; hi: number; cover: number }[]; years: string }) {
  const { t, f } = useI18n();
  return (
    <div className="space-y-2" data-testid="breach-strip">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {t(`Where the 80% range missed (${years}, no change)`, `Onde a faixa de 80% errou (${years}, sem variação)`)}
      </p>
      {rows.map((r) => {
        const inside = Math.max(0, 1 - r.lo - r.hi);
        return (
          <div key={r.h} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-xs" data-testid={`breach-${r.h}`}>
            <span className="text-ink-2">{f.horizon(r.h)}</span>
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div style={{ width: `${r.lo * 100}%`, background: "var(--down)" }} />
                <div style={{ width: `${inside * 100}%`, background: "var(--neutral)", opacity: 0.55 }} />
                <div style={{ width: `${r.hi * 100}%`, background: "var(--up)" }} />
              </div>
              <p className="tabular mt-0.5 flex justify-between text-muted">
                <span>
                  <span className="text-down">{f.pct(r.lo)}</span> {t("fell below", "abaixo")}
                </span>
                <span>
                  {f.pct(r.cover)} {t("inside", "dentro")}
                </span>
                <span>
                  <span className="text-up">{f.pct(r.hi)}</span> {t("rose above", "acima")}
                </span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PublishedVsOutcome({ archive, k }: { archive: ArchiveIndex; k: number }) {
  const { t, f } = useI18n();
  const usd = (v: number | null) => (v === null ? "—" : f.num(v * k, 0));
  const rows = archive.entries.flatMap((e) => e.horizons.map((h) => ({ e, h })));
  return (
    <section className="card space-y-3 p-5" data-testid="published-vs-outcome">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Published outlooks against what happened", "Perspectivas publicadas contra o que aconteceu")}</h2>
        <p className="max-w-3xl text-sm text-ink-2">
          {t(
            "Every outlook this site publishes is frozen in an append-only archive on the day it goes out, and scored here once its target date passes. Nothing in these rows was ever used to choose a model or a range method, so, as they mature, this becomes the only genuinely unseen out-of-sample record.",
            "Cada perspectiva que este site publica é congelada num arquivo só de inclusão no dia em que sai, e avaliada aqui quando a data-alvo passa. Nada nestas linhas foi usado para escolher modelo ou método de faixa, então, à medida que vencem, este passa a ser o único registro fora da amostra realmente inédito.",
          )}
        </p>
      </div>
      <p className="text-sm" data-testid="archive-summary">
        <strong>{archive.n_outlooks}</strong>{" "}
        {t(
          archive.n_outlooks === 1 ? "outlook archived" : "outlooks archived",
          archive.n_outlooks === 1 ? "perspectiva arquivada" : "perspectivas arquivadas",
        )}{" "}
        · <strong>{archive.n_resolved}</strong> {t(`of ${rows.length} forecasts resolved`, `de ${rows.length} previsões resolvidas`)}
        {archive.n_resolved > 0 &&
          t(
            ` · inside the 80% range ${archive.inside80} of ${archive.n_resolved}, inside the 95% range ${archive.inside95} of ${archive.n_resolved}`,
            ` · dentro da faixa de 80%: ${archive.inside80} de ${archive.n_resolved}; dentro da faixa de 95%: ${archive.inside95} de ${archive.n_resolved}`,
          )}
        {archive.prices_through && (
          <span className="text-muted">
            {" "}
            · {t("closes through", "fechamentos até")} {f.date(archive.prices_through)}
          </span>
        )}
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="stack-sm w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">{t("Published", "Publicada")}</th>
                <th className="py-2 font-medium">{t("Horizon", "Horizonte")}</th>
                <th className="py-2 font-medium">{t("Target", "Alvo")}</th>
                <th className="py-2 text-right font-medium">{t("Central", "Central")}</th>
                <th className="py-2 text-right font-medium">{t("80% range", "Faixa de 80%")}</th>
                <th className="py-2 text-right font-medium">{t("Outcome", "Resultado")}</th>
                <th className="py-2 text-right font-medium">80%</th>
                <th className="py-2 text-right font-medium">95%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, h }) => (
                <tr key={`${e.file ?? e.as_of_close}-${e.latest_wasde}-${h.h}`} className="border-b border-line last:border-0" data-status={h.status}>
                  <td className="py-1.5">
                    <span>
                      {f.date(e.as_of_close)}{" "}
                      <span className="font-normal text-muted">
                        ({t(`${f.monthAbbr(Number(e.latest_wasde.slice(5, 7)))} WASDE`, `WASDE de ${f.monthAbbr(Number(e.latest_wasde.slice(5, 7)))}`)})
                      </span>
                    </span>
                  </td>
                  <td data-label={t("Horizon", "Horizonte")} className="py-1.5">
                    {f.horizon(h.h)}
                  </td>
                  <td data-label={t("Target", "Alvo")} className="py-1.5">
                    {f.date(h.target_date)}
                  </td>
                  <td data-label={t("Central", "Central")} className="tabular py-1.5 text-right">
                    {usd(h.central)}
                  </td>
                  <td data-label={t("80% range", "Faixa de 80%")} className="tabular py-1.5 text-right">
                    {usd(h.low80)}–{usd(h.high80)}
                  </td>
                  <td data-label={t("Outcome", "Resultado")} className="tabular py-1.5 text-right">
                    {h.status === "resolved" ? usd(h.actual) : <span className="text-muted">{t("pending", "pendente")}</span>}
                  </td>
                  <td data-label="80%" className="py-1.5 text-right">
                    <Outcome ok={h.inside80} label="80%" />
                  </td>
                  <td data-label="95%" className="py-1.5 text-right">
                    <Outcome ok={h.inside95} label="95%" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        {t(
          "CBOT front month, USD/t; the outcome is the last close on or before the target date. The archive files are published at",
          "Primeiro vencimento da CBOT, USD/t; o resultado é o último fechamento até a data-alvo. Os arquivos ficam em",
        )}{" "}
        <a className="underline hover:text-ink" href="/data/archive/index.json">
          /data/archive/
        </a>{" "}
        {t("and a refresh is rejected if it would change or remove one.", "e uma atualização é rejeitada se alterar ou remover algum.")}
      </p>
    </section>
  );
}

/** Spoken range of the WASDE model's MDE across horizons, e.g. "~6% (5–7% by horizon)". */
export function mdeText(values: number[], loc: Locale = "en"): string | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const lo = Math.round(s[0] * 100);
  const hi = Math.round(s[s.length - 1] * 100);
  return lo === hi ? `~${lo}%` : `~${Math.round(med * 100)}% (${lo}–${hi}% ${loc === "pt-BR" ? "por horizonte" : "by horizon"})`;
}

export default function TrackRecordView({ meta, view, archive }: { meta: Meta; view: TrackView; archive: ArchiveIndex }) {
  const { t, f, d, loc } = useI18n();
  const SHORT = short(loc);
  const signedPct = signedPctF(f);
  const [h, setH] = useState(3);
  const [model, setModel] = useState<ModelId>("rw");
  const k = meta.consts.bu_per_t / 100;
  const m = view.metrics;
  const valYears = `${meta.splits.validation[0].slice(0, 4)}–${meta.splits.validation[1].slice(0, 4)}`;
  const holdYears = `${meta.splits.holdout_start.slice(0, 4)}+`;
  const testsBy = useMemo(() => new Map(view.tests.map((t) => [`${t.model}-${t.h}`, t])), [view.tests]);

  // ---- verdict (always visible): no model beat no change, and how big an edge we could have seen
  const allRw = HS.every((hh) => meta.champion[String(hh)] === "rw");
  const mdes = HS.map((hh) => find(m, "validation", "ridge", hh)?.mde_mae).filter((v): v is number => v != null);
  const mde = mdeText(mdes, loc);
  const verdict = allRw
    ? t(
        `No model beat no change at any horizon, Holm-adjusted${mde ? `; we could detect a ${mde} lower error by the WASDE model` : ""}.`,
        `Nenhum modelo superou o sem variação em nenhum horizonte, com ajuste de Holm${
          mde ? `; conseguiríamos detectar um erro ${mde} menor do modelo WASDE` : ""
        }.`,
      )
    : `${HS.filter((hh) => meta.champion[String(hh)] !== "rw")
        .map((hh) => t(`${SHORT[meta.champion[String(hh)]]} beat no change at ${f.horizon(hh)}`, `${SHORT[meta.champion[String(hh)]]} superou o sem variação em ${f.horizon(hh)}`))
        .join("; ")} (${t("Holm-adjusted", "ajuste de Holm")}).`;
  const breach = HS.map((hh) => {
    const r = find(m, "validation", "rw", hh);
    return { h: hh, lo: r?.miss_lo80 ?? 0, hi: r?.miss_hi80 ?? 0, cover: r?.cover80 ?? 0 };
  });

  // ---- dot plot: % MAE vs no change, per challenger and horizon
  const dots = useMemo(
    () =>
      HS.flatMap((hh) =>
        CHALLENGERS.map((mo) => {
          const v = find(m, "validation", mo, hh);
          const ho = find(m, "holdout", mo, hh);
          const ci = maeVsNoChange(v?.mase, testsBy.get(`${mo}-${hh}`)?.dm_mae_t);
          return {
            label: `${SHORT[mo]} · ${hh}m`,
            model: mo,
            h: hh,
            val: ci?.d ?? null,
            lo: ci?.lo ?? null,
            hi: ci?.hi ?? null,
            hold: ho?.mase == null ? null : (ho.mase - 1) * 100,
          };
        }),
      ).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, testsBy, loc],
  );

  const dotOption = useCallback(
    (tk: Tokens) => {
      const cats = dots.map((d) => d.label);
      const span = Math.max(10, ...dots.flatMap((d) => [d.lo, d.hi, d.val, d.hold].filter((x): x is number => x !== null).map(Math.abs)));
      const lim = Math.ceil(span / 5) * 5;
      return {
        ...baseOption(tk),
        grid: { ...baseOption(tk).grid, top: 36, left: 8, right: 24 },
        legend: {
          top: 0,
          left: 0,
          data: [`${t("Validation", "Validação")} ${valYears}`, `Holdout ${holdYears}`],
          textStyle: { color: tk.ink2 },
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          ...baseOption(tk).tooltip,
          trigger: "item",
          formatter: (p: { dataIndex: number; seriesName: string }) => {
            const d = dots[p.dataIndex];
            if (!d) return "";
            const ci =
              d.lo !== null && d.hi !== null
                ? `<br/>${t("95% interval (DM)", "Intervalo de 95% (DM)")}: ${signedPct(d.lo)} ${t("to", "a")} ${signedPct(d.hi)}`
                : "";
            const v = d.val === null ? "—" : signedPct(d.val);
            const ho = d.hold === null ? "—" : signedPct(d.hold);
            return `<b>${SHORT[d.model]}, ${f.horizon(d.h)}</b><br/>${t("Validation", "Validação")}: ${v} ${t(
              "MAE vs no change",
              "MAE contra sem variação",
            )}${ci}<br/>Holdout: ${ho}`;
          },
        },
        xAxis: {
          type: "value",
          min: -lim,
          max: lim,
          ...axisCommon(tk),
          axisLabel: { ...axisCommon(tk).axisLabel, formatter: (v: number) => signedPct(v, 0) },
          name: t("error vs no change (− = better)", "erro contra sem variação (− = melhor)"),
          nameLocation: "middle",
          nameGap: 26,
          nameTextStyle: { color: tk.muted, fontSize: 11 },
        },
        yAxis: { type: "category", data: cats, ...axisCommon(tk), splitLine: { show: false }, axisLabel: { color: tk.ink2, fontSize: 11 } },
        series: [
          {
            name: `${t("Validation", "Validação")} ${valYears}`,
            type: "line",
            symbol: "circle",
            symbolSize: 9,
            lineStyle: { width: 0 },
            itemStyle: { color: tk.ink2 },
            data: dots.map((d, i) => [d.val, i]),
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              label: { show: false },
              data: [
                [
                  { coord: [0, 0], lineStyle: { color: tk.ink, width: 1.25, type: "solid" } },
                  { coord: [0, cats.length - 1] },
                ],
                ...dots
                  .map((d, i) =>
                    d.lo === null || d.hi === null
                      ? null
                      : [
                          { coord: [d.lo, i], lineStyle: { color: tk.neutral, width: 2, type: "solid" } },
                          { coord: [d.hi, i] },
                        ],
                  )
                  .filter((x) => x !== null),
              ],
            },
          },
          {
            name: `Holdout ${holdYears}`,
            type: "line",
            symbol: "diamond",
            symbolSize: 10,
            lineStyle: { width: 0 },
            itemStyle: { color: "transparent", borderColor: tk.ink, borderWidth: 1.5 },
            data: dots.map((d, i) => [d.hold, i]),
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dots, valYears, holdYears, f],
  );

  // ---- path chart: holdout shading, 80% misses, roll flags
  const raw = view.paths[String(h)];
  const path = useMemo(
    () => ({ ...raw, t: raw.t.map(isoDay), split: [...raw.split], roll: [...raw.roll].map(Number), crop: [...raw.crop].map(Number) }),
    [raw],
  );
  const L = {
    band: t("80% range", "Faixa de 80%"),
    fc: t(`Forecast made ${f.horizon(h)} earlier`, `Previsão feita ${f.horizon(h)} antes`),
    actual: t("Actual CBOT", "CBOT realizado"),
    miss: t("Outside the 80% range", "Fora da faixa de 80%"),
    crop: t("Crosses old→new crop roll", "Cruza a rolagem safra velha→nova"),
  };
  const pathOption = useCallback(
    (tk: Tokens) => {
      const pm = path.models[model as (typeof PATH_MODELS)[number]];
      const n = path.t.length;
      const iBand = [...Array(n).keys()].filter((i) => pm.lo[i] !== null && pm.hi[i] !== null);
      const miss = [...Array(n).keys()].filter(
        (i) => path.actual[i] !== null && pm.lo[i] !== null && pm.hi[i] !== null && (path.actual[i]! < pm.lo[i]! || path.actual[i]! > pm.hi[i]!),
      );
      const crop = [...Array(n).keys()].filter((i) => path.crop[i] === 1 && path.actual[i] !== null);
      const holdStart = path.t[path.split.indexOf("h")];
      const lastT = path.t[n - 1];
      return {
        ...baseOption(tk),
        legend: {
          top: 0,
          left: 0,
          data: [L.band, L.fc, L.actual, L.miss, L.crop],
          textStyle: { color: tk.ink2 },
          itemWidth: 14,
          itemHeight: 8,
        },
        tooltip: {
          ...baseOption(tk).tooltip,
          trigger: "axis",
          formatter: (ps: { dataIndex: number; seriesName: string; value: [string, number | null] }[]) => {
            const p = ps.find((x) => x.seriesName === L.actual) ?? ps.find((x) => x.seriesName === L.fc);
            if (!p) return "";
            const i = path.t.indexOf(p.value[0]);
            if (i < 0) return "";
            const lines = [
              `<b>${f.date(path.t[i])}</b> · ${path.split[i] === "h" ? "holdout" : t("validation", "validação")}`,
              `${t("Actual", "Realizado")}: ${path.actual[i] === null ? t("pending", "pendente") : `${f.num(path.actual[i], 0)} USD/t`}`,
              `${t("Forecast", "Previsão")}: ${f.num(pm.f[i], 0)} USD/t`,
              pm.lo[i] === null
                ? t("80% range: not yet (too few past errors)", "Faixa de 80%: ainda não (poucos erros passados)")
                : `${t("80% range", "Faixa de 80%")}: ${f.num(pm.lo[i], 0)}–${f.num(pm.hi[i], 0)} USD/t`,
            ];
            if (path.roll[i])
              lines.push(
                path.crop[i]
                  ? t("Window crosses the old→new crop roll", "A janela cruza a rolagem safra velha→nova")
                  : t("Window crosses a contract roll", "A janela cruza uma rolagem de contrato"),
              );
            return lines.join("<br/>");
          },
        },
        grid: { ...baseOption(tk).grid, top: 56 },
        xAxis: { type: "time", ...axisCommon(tk), axisLabel: timeAxisLabel(tk, f.monthAbbr), splitLine: { show: false } },
        yAxis: { type: "value", scale: true, name: "USD/t", nameTextStyle: { color: tk.muted }, ...axisCommon(tk) },
        series: [
          {
            name: "band-low",
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            data: iBand.map((i) => [path.t[i], pm.lo[i]]),
            tooltip: { show: false },
            silent: true,
            markArea: holdStart
              ? {
                  silent: true,
                  itemStyle: { color: tk.grid, opacity: 0.45 },
                  label: { show: true, position: "insideTopLeft", color: tk.muted, fontSize: 11, formatter: "holdout" },
                  data: [[{ xAxis: holdStart }, { xAxis: lastT }]],
                }
              : undefined,
          },
          {
            name: L.band,
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: { color: tk.series1, opacity: 0.2 },
            itemStyle: { color: tk.series1, opacity: 0.4 },
            data: iBand.map((i) => [path.t[i], Math.round((pm.hi[i]! - pm.lo[i]!) * 10) / 10]),
            tooltip: { show: false },
          },
          {
            name: L.fc,
            type: "line",
            symbol: "none",
            lineStyle: { color: tk.series1, width: 1.5, type: "dashed" },
            itemStyle: { color: tk.series1 },
            data: path.t.map((d, i) => [d, pm.f[i]]),
          },
          {
            name: L.actual,
            type: "line",
            symbol: "none",
            lineStyle: { color: tk.ink, width: 1.5 },
            itemStyle: { color: tk.ink },
            data: path.t.map((d, i) => [d, path.actual[i]]).filter((x) => x[1] !== null),
          },
          {
            name: L.miss,
            type: "line",
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { width: 0 },
            itemStyle: { color: tk.warn, borderColor: tk.surface, borderWidth: 1 },
            data: miss.map((i) => [path.t[i], path.actual[i]]),
            tooltip: { show: false },
            z: 4,
          },
          {
            name: L.crop,
            type: "line",
            symbol: "triangle",
            symbolSize: 7,
            lineStyle: { width: 0 },
            itemStyle: { color: tk.surface, borderColor: tk.ink2, borderWidth: 1.25 },
            data: crop.map((i) => [path.t[i], path.actual[i]]),
            tooltip: { show: false },
            z: 3,
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, h, model, f],
  );

  const pm = path.models[model as (typeof PATH_MODELS)[number]];
  const rollShare = {
    n: path.roll.filter((x) => x === 1).length,
    crop: path.crop.filter((x) => x === 1).length,
    total: path.t.length,
  };
  const nMiss = path.t.filter(
    (_, i) => path.actual[i] !== null && pm.lo[i] !== null && pm.hi[i] !== null && (path.actual[i]! < pm.lo[i]! || path.actual[i]! > pm.hi[i]!),
  ).length;
  const nScored = path.t.filter((_, i) => path.actual[i] !== null && pm.lo[i] !== null).length;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <p className="text-sm font-medium text-brand">{t("Out-of-sample, one forecast per WASDE report", "Fora da amostra, uma previsão por relatório WASDE")}</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">
          {t("Did any model beat “no change”?", "Algum modelo superou o “sem variação”?")}
        </h1>
        <div className="card grid gap-5 p-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-2">
            <p className="text-lg font-semibold leading-snug text-ink" data-testid="verdict">
              {verdict}
            </p>
            <p className="text-sm leading-relaxed text-ink-2">
              {t(
                `Every forecast was made with only what was public on that report day and scored later against the actual CBOT close. Models were compared on ${f.date(
                  meta.splits.validation[0],
                )} – ${f.date(meta.splits.validation[1])}; the reports since ${f.date(
                  meta.splits.holdout_start,
                )} were kept aside and not used for any model choice (I had seen 2024–25 prices, so they are not a blind test).`,
                `Cada previsão foi feita só com o que era público no dia do relatório e avaliada depois contra o fechamento real da CBOT. Os modelos foram comparados de ${f.date(
                  meta.splits.validation[0],
                )} a ${f.date(meta.splits.validation[1])}; os relatórios desde ${f.date(
                  meta.splits.holdout_start,
                )} ficaram de lado e não foram usados para escolher nenhum modelo (eu já tinha visto os preços de 2024–25, então não é um teste cego).`,
              )}
            </p>
          </div>
          <BreachStrip rows={breach} years={valYears} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {HS.map((hh) => {
          const rw = find(m, "validation", "rw", hh);
          const rwH = find(m, "holdout", "rw", hh);
          const others = CHALLENGERS.map((x) => find(m, "validation", x, hh)).filter((x): x is SlimMetric => !!x);
          const best = others.reduce<SlimMetric | undefined>((a, b) => ((b.mase ?? 9) < (a?.mase ?? 9) ? b : a), undefined);
          const mdeRidge = find(m, "validation", "ridge", hh)?.mde_mae;
          const champ = meta.champion[String(hh)];
          const dd = best?.mase == null ? null : (best.mase - 1) * 100;
          return (
            <article key={hh} className="card space-y-3 p-5" data-testid={`tr-card-${hh}`}>
              <h2 className="text-sm font-medium text-ink-2">{t(`${f.horizon(hh)} ahead`, `${f.horizon(hh)} à frente`)}</h2>
              <p className="text-2xl font-semibold tracking-tight">
                {t("Winner", "Vencedor")}: {champ === "rw" ? t("no change", "sem variação") : SHORT[champ]}
              </p>
              <p className="text-sm text-ink-2" data-testid={`rival-${hh}`}>
                {best && dd !== null
                  ? t(
                      `Closest rival: ${SHORT[best.model]}, ${f.num(Math.abs(dd), 1)}% ${dd > 0 ? "worse" : dd < 0 ? "better" : "level"}.`,
                      `Rival mais próximo: ${SHORT[best.model]}, ${f.num(Math.abs(dd), 1)}% ${dd > 0 ? "pior" : dd < 0 ? "melhor" : "empatado"}.`,
                    )
                  : t("No rival scored.", "Nenhum rival avaliado.")}
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-2">{t("Typical miss, no change", "Erro típico, sem variação")}</dt>
                <dd className="tabular text-right">{f.num(rw?.mae_usd_t, 1)} USD/t</dd>
                <dt className="text-ink-2">
                  {t("80% range", "Faixa de 80%,")} <Term k="hit">{t("hit rate", "taxa de acerto")}</Term>
                </dt>
                <dd className="tabular text-right">
                  {f.pct(rw?.cover80)} <span className="text-muted">/ {f.pct(rwH?.cover80)} holdout</span>
                </dd>
                <dt className="text-ink-2">
                  {t("95% range", "Faixa de 95%,")} <Term k="hit">{t("hit rate", "taxa de acerto")}</Term>
                </dt>
                <dd className="tabular text-right">
                  {f.pct(rw?.cover95)} <span className="text-muted">/ {f.pct(rwH?.cover95)} holdout</span>
                </dd>
              </dl>
              {mdeRidge != null && (
                <p className="text-xs leading-relaxed text-ink-2" data-testid={`mde-${hh}`}>
                  {t(
                    `We could detect a ~${f.num(mdeRidge * 100, 0)}% lower error by the WASDE model than by no change; ${
                      champ === "rw" ? "none was found." : `${meta.models[champ]} passed.`
                    }`,
                    `Conseguiríamos detectar um erro ~${f.num(mdeRidge * 100, 0)}% menor do modelo WASDE do que do sem variação; ${
                      champ === "rw" ? "nenhum foi encontrado." : `${d(meta.models[champ])} passou.`
                    }`,
                  )}
                </p>
              )}
              {hh > 1 && (
                <p className="text-xs text-muted">
                  {t(
                    `Overlapping ${hh}-month windows: few independent outcomes, low power.`,
                    `Janelas de ${hh} meses sobrepostas: poucos resultados independentes, baixo poder.`,
                  )}
                </p>
              )}
            </article>
          );
        })}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">{t("Error against no change, by model and horizon", "Erro contra o sem variação, por modelo e horizonte")}</h2>
        <Chart
          option={dotOption}
          height={340}
          ariaLabel={t(
            "Dot plot of each challenger's mean absolute error relative to no change, with intervals",
            "Gráfico de pontos do erro absoluto médio de cada desafiante em relação ao sem variação, com intervalos",
          )}
        />
        <ChartData
          testId="dots-data"
          caption={t("Mean absolute error vs no change", "Erro absoluto médio contra o sem variação")}
          columns={[
            t("Model · horizon", "Modelo · horizonte"),
            `${t("Validation", "Validação")} ${valYears}`,
            t("95% interval (DM)", "Intervalo de 95% (DM)"),
            `Holdout ${holdYears}`,
          ]}
          rows={[...dots].reverse().map((x) => [
            x.label,
            x.val === null ? "—" : signedPct(x.val),
            x.lo === null || x.hi === null ? "—" : `${signedPct(x.lo)} ${t("to", "a")} ${signedPct(x.hi)}`,
            x.hold === null ? "—" : signedPct(x.hold),
          ])}
        />
        <p className="text-xs leading-relaxed text-muted">
          {t(
            <>
              Each dot is a challenger&apos;s mean absolute error (USD/t) relative to no change: left of the line is better,
              right is worse. Circles: validation {valYears}, with an approximate 95% interval from the{" "}
              <Term k="dm">Diebold-Mariano</Term> statistic on the same errors. Hollow diamonds: holdout {holdYears}, no
              interval (few reports). Challengers share one neutral colour on purpose: none of them is the answer.
            </>,
            <>
              Cada ponto é o erro absoluto médio (USD/t) de um desafiante em relação ao sem variação: à esquerda da linha é
              melhor, à direita é pior. Círculos: validação {valYears}, com um intervalo aproximado de 95% a partir da
              estatística de <Term k="dm">Diebold-Mariano</Term> sobre os mesmos erros. Losangos vazados: holdout {holdYears},
              sem intervalo (poucos relatórios). Os desafiantes dividem uma única cor neutra de propósito: nenhum deles é a
              resposta.
            </>,
          )}
        </p>
      </section>

      <PublishedVsOutcome archive={archive} k={k} />

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("Past forecasts against what happened", "Previsões passadas contra o que aconteceu")}</h2>
          <div className="flex flex-wrap gap-2">
            <RadioGroup legend={t("Horizon", "Horizonte")} value={h} onChange={setH} options={HS.map((x) => ({ id: x, label: f.horizon(x) }))} />
            <RadioGroup
              legend={t("Model", "Modelo")}
              value={model}
              onChange={setModel}
              options={([...PATH_MODELS] as ModelId[]).map((x) => ({ id: x, label: SHORT[x] }))}
            />
          </div>
        </div>
        <Chart
          option={pathOption}
          height={380}
          ariaLabel={t(
            "Past forecasts with 80% ranges against the actual CBOT price",
            "Previsões passadas com faixas de 80% contra o preço realizado da CBOT",
          )}
        />
        <ChartData
          testId="path-data"
          caption={t(`Past ${f.horizon(h)} forecasts, ${SHORT[model]}`, `Previsões passadas de ${f.horizon(h)}, ${SHORT[model]}`)}
          columns={[
            t("Target date", "Data-alvo"),
            t("Split", "Período"),
            t("Forecast, USD/t", "Previsão, USD/t"),
            t("80% range", "Faixa de 80%"),
            t("Actual, USD/t", "Realizado, USD/t"),
          ]}
          rows={path.t.map((day, i) => [
            f.date(day),
            path.split[i] === "h" ? "holdout" : t("validation", "validação"),
            f.num(pm.f[i], 0),
            pm.lo[i] === null ? "—" : `${f.num(pm.lo[i], 0)}–${f.num(pm.hi[i], 0)}`,
            path.actual[i] === null ? t("pending", "pendente") : f.num(path.actual[i], 0),
          ])}
        />
        <p className="text-xs leading-relaxed text-muted">
          {t(
            "Each point sits on the date the forecast was for; the shaded block is the holdout. Ranges start once",
            "Cada ponto fica na data para a qual a previsão foi feita; o bloco sombreado é o holdout. As faixas começam quando existem",
          )}{" "}
          <span data-testid="calib-min">{meta.calib_min}</span> {t("realized errors exist.", "erros realizados.")}{" "}
          <span data-testid="miss-count">
            {t(
              `${nMiss} of ${nScored} outcomes fell outside the 80% range (amber dots).`,
              `${nMiss} de ${nScored} resultados caíram fora da faixa de 80% (pontos âmbar).`,
            )}
          </span>{" "}
          {t(
            "CBOT front month, USD/t. The continuous front month jumps when a contract expires, so a window crossing a roll partly measures a calendar spread; the July–September rolls (old crop to new crop, triangles) are the largest.",
            "Primeiro vencimento da CBOT, USD/t. O primeiro vencimento contínuo salta quando um contrato expira, então uma janela que cruza uma rolagem mede em parte um spread entre vencimentos; as rolagens de julho a setembro (safra velha para nova, triângulos) são as maiores.",
          )}{" "}
          <span data-testid="roll-share">
            {t(
              `${rollShare.n} of ${rollShare.total} ${h}-month windows shown cross a roll (${rollShare.crop} an old-to-new-crop roll).`,
              `${rollShare.n} de ${rollShare.total} janelas de ${h} meses exibidas cruzam uma rolagem (${rollShare.crop} uma rolagem safra velha→nova).`,
            )}
          </span>
        </p>
      </section>

      <ForStatisticians meta={meta} view={view} testsBy={testsBy} valYears={valYears} holdYears={holdYears} />
    </div>
  );
}

function ForStatisticians({
  meta,
  view,
  testsBy,
  valYears,
  holdYears,
}: {
  meta: Meta;
  view: TrackView;
  testsBy: Map<string, TrackView["tests"][number]>;
  valYears: string;
  holdYears: string;
}) {
  const { t, f, d } = useI18n();
  const signedPct = signedPctF(f);
  const pFmt = pFmtF(f);
  const m = view.metrics;
  const allHolmOne = view.tests.every((t) => t.cw_p_holm !== null && t.cw_p_holm >= 0.9995);
  const methodLabel = meta.intervals.range_labels as Record<string, string>;
  // The fold's tables are rendered on first open: they are the bulk of the page's markup, and
  // keeping them out of the static HTML holds /track-record/ under its 100 KB budget.
  const [opened, setOpened] = useState(false);
  const RC = {
    score: t("Interval score vs ours, validation", "Interval score contra o nosso, validação"),
    hit: t("80% hit rate 1/3/6m, validation", "Taxa de acerto de 80% 1/3/6m, validação"),
    hold: t("Score, holdout (reported only)", "Score, holdout (só relatado)"),
  };
  return (
    <details
      className="card p-5 text-sm"
      id="for-statisticians"
      data-testid="for-statisticians"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-base font-semibold">
        {t("For statisticians: tests, calibration and the range method", "Para estatísticos: testes, calibração e o método das faixas")}
      </summary>
      {opened && (
      <div className="mt-4 space-y-6">
        <div className="space-y-2">
          <h3 className="font-semibold">
            {t(`Forecast accuracy tests (validation ${valYears})`, `Testes de acurácia das previsões (validação ${valYears})`)}
          </h3>
          <div className="overflow-x-auto">
            <table className="stack-sm w-full min-w-[36rem]" data-testid="tests-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">{t("Model", "Modelo")}</th>
                  <th className="py-2 font-medium">{t("Horizon", "Horizonte")}</th>
                  <th className="py-2 text-right font-medium">{t("MAE vs no change", "MAE contra sem variação")}</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="dm">DM</Term> <Term k="p">p</Term>
                  </th>
                  <th className="py-2 text-right font-medium">DM p (MAE)</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="cw">CW</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    CW p (<Term k="holm">Holm</Term>)
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.tests.map((r) => {
                  const mase = find(m, "validation", r.model, r.h)?.mase;
                  const worse = r.dm_t != null && r.dm_p != null && r.dm_t > 0 && r.dm_p < 0.05;
                  return (
                    <tr key={`${r.model}-${r.h}`} className="border-b border-line last:border-0">
                      <td className="py-1.5">
                        {d(meta.models[r.model])}
                        <span className="sm:hidden"> · {f.horizon(r.h)}</span>
                      </td>
                      <td data-label={t("Horizon", "Horizonte")} className="py-1.5 max-sm:!hidden">
                        {f.horizon(r.h)}
                      </td>
                      <td data-label={t("MAE vs no change", "MAE contra sem variação")} className="tabular py-1.5 text-right" data-testid={`mae-vs-${r.model}-${r.h}`}>
                        {mase == null ? "—" : signedPct((mase - 1) * 100)}
                      </td>
                      <td data-label="DM p" className="tabular py-1.5 text-right">
                        <span>
                          {pFmt(r.dm_p)} {worse ? <span className="text-down">({t("worse", "pior")})</span> : null}
                        </span>
                      </td>
                      <td data-label="DM p (MAE)" className="tabular py-1.5 text-right">
                        {pFmt(r.dm_mae_p)}
                      </td>
                      <td data-label="CW p" className="tabular py-1.5 text-right">
                        {pFmt(r.cw_p)}
                      </td>
                      <td data-label="CW p (Holm)" className="tabular py-1.5 text-right">
                        {pFmt(r.cw_p_holm)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {t(
              `DM: Diebold-Mariano on the ${meta.inference_rule.primary_loss} (the primary loss), Harvey-Leybourne-Newbold correction, Newey-West lag h−1; “DM p (MAE)” is the same test on absolute USD/t errors. CW: Clark-West, one-sided, for models that nest no change; Holm-adjusted across all nine tests. A model replaces no change only if Holm CW p < ${meta.champion_alpha} and its primary loss is lower.${
                allHolmOne
                  ? " The Holm column reads 1.000 everywhere: no raw CW p is small enough to stay below 1 after multiplying by the number of remaining tests, and Holm caps adjusted p-values at 1. It is kept because it is the column the decision rule uses."
                  : ""
              }`,
              `DM: Diebold-Mariano sobre o ${d(meta.inference_rule.primary_loss)} (a perda principal), com a correção de Harvey-Leybourne-Newbold e Newey-West com defasagem h−1; “DM p (MAE)” é o mesmo teste sobre os erros absolutos em USD/t. CW: Clark-West, unilateral, para modelos que contêm o sem variação; com ajuste de Holm sobre os nove testes. Um modelo só substitui o sem variação se o p de CW com Holm for < ${f.num(
                meta.champion_alpha,
                2,
              )} e a sua perda principal for menor.${
                allHolmOne
                  ? ` A coluna de Holm mostra ${f.num(1, 3)} em toda parte: nenhum p bruto de CW é pequeno o bastante para ficar abaixo de 1 depois de multiplicado pelo número de testes restantes, e Holm limita os p ajustados a 1. Ela fica porque é a coluna que a regra de decisão usa.`
                  : ""
              }`,
            )}{" "}
            {t("Interval for the dot plot:", "Intervalo do gráfico de pontos:")} d ± {f.num(1.96, 2)}·d/t<sub>DM</sub>{" "}
            {t("on the MAE version of the statistic.", "na versão MAE da estatística.")}
            {(() => {
              const tt = testsBy.get("ridge-1");
              return tt?.dm_mae_p != null && tt.dm_mae_p < 0.05
                ? t(
                    " The WASDE ridge model is significantly worse than no change on MAE at 1 month.",
                    " O modelo ridge com o WASDE é significativamente pior que o sem variação no MAE em 1 mês.",
                  )
                : "";
            })()}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">{t("Calibration of the published no-change ranges", "Calibração das faixas publicadas do sem variação")}</h3>
          <div className="overflow-x-auto">
            <table className="stack-sm w-full min-w-[44rem]" data-testid="calibration-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">{t("Range", "Faixa")}</th>
                  <th className="py-2 font-medium">{t("Horizon", "Horizonte")}</th>
                  <th className="py-2 font-medium">{t("Split", "Período")}</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="hit">{t("Hit rate", "Taxa de acerto")}</Term> ({t("95% CI", "IC 95%")})
                  </th>
                  <th className="py-2 text-right font-medium">n_eff</th>
                  <th className="py-2 text-right font-medium">{t("Below / above", "Abaixo / acima")}</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="kupiec">Kupiec</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    <Term k="christ">Christoffersen</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    <Term k="mde">MDE</Term> (ridge)
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["80", "95"] as const).flatMap((lv) =>
                  HS.flatMap((hh) =>
                    (["validation", "holdout"] as const).map((sp) => {
                      const r = find(m, sp, "rw", hh);
                      const ridge = find(m, sp, "ridge", hh);
                      if (!r) return null;
                      const c = lv === "80" ? r.cover80 : r.cover95;
                      const lo = lv === "80" ? r.cover80_ci_lo : r.cover95_ci_lo;
                      const hi = lv === "80" ? r.cover80_ci_hi : r.cover95_ci_hi;
                      const ne = lv === "80" ? r.cover80_n_eff : r.cover95_n_eff;
                      const mlo = lv === "80" ? r.miss_lo80 : r.miss_lo95;
                      const mhi = lv === "80" ? r.miss_hi80 : r.miss_hi95;
                      const ku = lv === "80" ? r.kupiec80_p : r.kupiec95_p;
                      const ch = lv === "80" ? r.christ80_p : r.christ95_p;
                      return (
                        <tr key={`${lv}-${hh}-${sp}`} className="border-b border-line last:border-0">
                          <td className="py-1.5">
                            {lv}% · {f.horizon(hh)} · {sp === "validation" ? valYears : holdYears}
                          </td>
                          <td data-label={t("Horizon", "Horizonte")} className="py-1.5 max-sm:!hidden">
                            {f.horizon(hh)}
                          </td>
                          <td data-label={t("Split", "Período")} className="py-1.5 text-ink-2 max-sm:!hidden">
                            {sp === "validation" ? valYears : holdYears}
                          </td>
                          <td data-label={t("Hit rate (95% CI)", "Taxa de acerto (IC 95%)")} className="tabular py-1.5 text-right">
                            <span>
                              {f.pct(c)} <span className="text-muted">({f.pct(lo)}–{f.pct(hi)})</span>
                            </span>
                          </td>
                          <td data-label="n_eff" className="tabular py-1.5 text-right">
                            {f.num(ne, 0)}
                          </td>
                          <td data-label={t("Below / above", "Abaixo / acima")} className="tabular py-1.5 text-right">
                            {f.pct(mlo)} / {f.pct(mhi)}
                          </td>
                          <td data-label="Kupiec p" className="tabular py-1.5 text-right">
                            {pFmt(ku)}
                          </td>
                          <td data-label="Christoffersen p" className="tabular py-1.5 text-right">
                            {pFmt(ch)}
                          </td>
                          <td data-label={t("MDE (ridge)", "MDE (ridge)")} className="tabular py-1.5 text-right">
                            {ridge?.mde_mae == null ? "—" : f.pct(ridge.mde_mae)}
                          </td>
                        </tr>
                      );
                    }),
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {t("Method", "Método")}: {d(meta.inference_rule.calibration)}.{" "}
            {t(
              "The median p over the h every-h-th subsamples is used because overlapping windows break the independence those two tests assume.",
              "Usa-se o p mediano das h subamostras de h em h porque janelas sobrepostas quebram a independência que esses dois testes supõem.",
            )}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">
            {t("Our range method against a plain volatility band", "O nosso método de faixas contra uma banda simples de volatilidade")}
          </h3>
          <div className="overflow-x-auto">
            <table className="stack-sm w-full min-w-[38rem]" data-testid="range-choice-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">{t("Method", "Método")}</th>
                  <th className="py-2 text-right font-medium">{RC.score}</th>
                  <th className="py-2 text-right font-medium">{RC.hit}</th>
                  <th className="py-2 text-right font-medium">{RC.hold}</th>
                </tr>
              </thead>
              <tbody>
                {meta.intervals.range_candidates.map((mt) => {
                  const v = view.rangeChoice.find((r) => r.method === mt && r.split === "validation");
                  const ho = view.rangeChoice.find((r) => r.method === mt && r.split === "holdout");
                  return (
                    <tr key={mt} className="border-b border-line last:border-0">
                      <td className="py-1.5">
                        <span>
                          {d(methodLabel[mt] ?? mt)}
                          {v?.chosen && <span className="ml-1.5 text-xs font-normal text-muted">({t("published", "publicado")})</span>}
                        </span>
                      </td>
                      <td data-label={RC.score} className="tabular py-1.5 text-right">
                        {f.num(v?.score_ratio, 3)}
                      </td>
                      <td data-label={RC.hit} className="tabular py-1.5 text-right">
                        {HS.map((hh) => f.pct(view.rangeDiag.find((r) => r.method === mt && r.split === "validation" && r.h === hh)?.c80)).join(" / ")}
                      </td>
                      <td data-label={RC.hold} className="tabular py-1.5 text-right">
                        {f.num(ho?.score_ratio, 3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {d(meta.intervals.range_rule)}{" "}
            {t(
              "Below 1 = a better interval score than ours (sharper for the same coverage).",
              "Abaixo de 1 = interval score melhor que o nosso (mais estreito para a mesma cobertura).",
            )}
            {(() => {
              const better = view.rangeChoice.filter((r) => r.split === "holdout" && !r.chosen && (r.score_ratio ?? 9) < 1);
              const names = better.map((r) => d(methodLabel[r.method] ?? r.method)).join(t(" and ", " e "));
              return better.length
                ? t(
                    ` On the holdout ${names} scored better; that is reported and not acted on, because choosing on the holdout would spend it.`,
                    ` No holdout, ${names} pontuou melhor; isso é relatado e não gera ação, porque escolher pelo holdout o gastaria.`,
                  )
                : "";
            })()}
          </p>
        </div>
      </div>
      )}
    </details>
  );
}
