"use client";

import { useCallback, useState } from "react";

import Chart from "@/components/Chart";
import ChartData from "@/components/ChartData";
import RadioGroup from "@/components/RadioGroup";
import { axisCommon, baseOption, type Tokens } from "@/lib/chart";
import type { Stress } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";
/** Simple return (%) of a log return. */
const simple = (lr: number) => (Math.exp(lr) - 1) * 100;

/** The body of the stress replay (P19), loaded on demand when the fold is first opened. */
export default function StressBody({ stress, buPerT }: { stress: Stress; buPerT: number }) {
  const { t, f, d } = useI18n();
  const sgnPct = (v: number, dd = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${f.num(Math.abs(v), dd)}%`;
  const hs = stress.horizons.map((x) => x.h);
  const [h, setH] = useState(hs.includes(3) ? 3 : hs[0]);
  const sh = stress.horizons.find((x) => x.h === h) ?? stress.horizons[0];
  const dist = sh.distribution;
  const p0UsdT = (stress.p0_c_bu / 100) * buPerT;
  const binOfLr = (lr: number) =>
    Math.min(dist.counts.length - 1, Math.max(0, dist.bin_edges.findIndex((e, i) => lr >= e && lr < dist.bin_edges[i + 1])));

  const option = useCallback(
    (tk: Tokens) => {
      const edges = dist.bin_edges;
      const cats = dist.counts.map((_, i) => sgnPct(simple((edges[i] + edges[i + 1]) / 2), 0));
      const binOf = (lr: number) => Math.min(dist.counts.length - 1, Math.max(0, edges.findIndex((e, i) => lr >= e && lr < edges[i + 1])));
      const marked = new Set(sh.episodes.map((e) => binOf(e.logret)));
      return {
        ...baseOption(tk),
        grid: { ...baseOption(tk).grid, top: 28, bottom: 4 },
        tooltip: {
          ...baseOption(tk).tooltip,
          trigger: "axis",
          formatter: (ps: { dataIndex: number; value: number }[]) => {
            const p = ps[0];
            if (!p) return "";
            const i = p.dataIndex;
            const eps = sh.episodes.filter((e) => binOf(e.logret) === i).map((e) => d(e.name));
            return [
              `${sgnPct(simple(edges[i]))} ${t("to", "a")} ${sgnPct(simple(edges[i + 1]))}`,
              t(`${f.num(p.value)} of ${f.num(dist.n)} ${h}-month windows`, `${f.num(p.value)} de ${f.num(dist.n)} janelas de ${h} meses`),
              ...(eps.length ? [`<b>${eps.join(", ")}</b>`] : []),
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: cats,
          ...axisCommon(tk),
          splitLine: { show: false },
          axisLabel: { ...axisCommon(tk).axisLabel, interval: 3 },
        },
        yAxis: { type: "value", ...axisCommon(tk), name: t("windows", "janelas"), nameTextStyle: { color: tk.muted } },
        series: [
          {
            name: t(`${h}-month CBOT moves`, `Movimentos da CBOT em ${h} meses`),
            type: "bar",
            barCategoryGap: "8%",
            data: dist.counts.map((c, i) => ({
              value: c,
              itemStyle: { color: marked.has(i) ? tk.series2 : tk.neutral, borderRadius: [2, 2, 0, 0] },
            })),
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              label: { color: tk.muted, fontSize: 11, formatter: "{b}" },
              lineStyle: { color: tk.axis, type: "solid" },
              data: [{ xAxis: binOf(0), name: t("no change", "sem variação") }],
            },
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dist, sh.episodes, h, f],
  );

  const edges = dist.bin_edges;
  return (
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
            {t(
              `If the CBOT move of a named episode happened again from today's close (${f.num(stress.p0_c_bu)}¢/bu, ≈ US$ ${f.num(
                p0UsdT,
              )}/t). These are scenarios, not probabilities: the five episodes were named before any outcome was computed, and the bars show how common moves of each size have been. They complement the 95% range, whose tails rest on only one or two past errors.`,
              `Se o movimento da CBOT de um episódio nomeado se repetisse a partir do fechamento de hoje (${f.num(stress.p0_c_bu)}¢/bu, ≈ US$ ${f.num(
                p0UsdT,
              )}/t). São cenários, não probabilidades: os cinco episódios foram nomeados antes de qualquer resultado ser calculado, e as barras mostram quão comuns foram os movimentos de cada tamanho. Eles complementam a faixa de 95%, cujas caudas se apoiam em apenas um ou dois erros passados.`,
            )}
          </p>
          <RadioGroup
            legend={t("Stress horizon", "Horizonte do estresse")}
            value={h}
            onChange={setH}
            options={hs.map((x) => ({ id: x, label: f.horizon(x) }))}
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="overflow-x-auto">
            <table className="stack-sm w-full min-w-[34rem] text-sm" data-testid="stress-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">{t("Episode", "Episódio")}</th>
                  <th className="py-2 text-right font-medium">{t(`${h}-month move`, `Movimento em ${h} meses`)}</th>
                  <th className="py-2 text-right font-medium">{t("Rank", "Posição")}</th>
                  <th className="py-2 text-right font-medium">¢/bu</th>
                  <th className="py-2 text-right font-medium">USD/t</th>
                  <th className="py-2 text-right font-medium">{t("R$/sack*", "R$/saca*")}</th>
                </tr>
              </thead>
              <tbody>
                {sh.episodes.map((e) => (
                  <tr key={e.id} className="border-b border-line align-top last:border-0">
                    <td className="py-1.5">
                      <span>
                        <span className="font-medium text-ink">{d(e.name)}</span>
                        <span className="block text-xs font-normal text-muted" title={d(e.rationale)}>
                          {t("from", "a partir de")} {f.date(e.start)}
                        </span>
                      </span>
                    </td>
                    <td
                      data-label={t(`${h}-month move`, `Movimento em ${h} meses`)}
                      className={`tabular py-1.5 text-right font-medium ${e.pct < 0 ? "text-down" : e.pct > 0 ? "text-up" : ""}`}
                    >
                      {sgnPct(e.pct)}
                    </td>
                    <td data-label={t("Rank", "Posição")} className="tabular py-1.5 text-right text-ink-2">
                      p{f.num(e.percentile, 0)}
                    </td>
                    <td data-label="¢/bu" className="tabular py-1.5 text-right">
                      {f.num(e.c_bu)}
                    </td>
                    <td data-label="USD/t" className="tabular py-1.5 text-right">
                      {f.num(e.usd_t)}
                    </td>
                    <td data-label={t("R$/sack*", "R$/saca*")} className="tabular py-1.5 text-right">
                      {f.num(e.cbot_brl_sack, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <Chart
              option={option}
              height={240}
              ariaLabel={t(
                `Histogram of all ${h}-month CBOT moves since ${dist.first.slice(0, 4)}, with the stress episodes highlighted`,
                `Histograma de todos os movimentos da CBOT em ${h} meses desde ${dist.first.slice(0, 4)}, com os episódios de estresse destacados`,
              )}
            />
            <p className="tabular text-xs text-muted">
              {t(
                `All ${f.num(dist.n)} ${h}-month windows starting ${dist.first.slice(0, 4)}–${dist.last_start.slice(0, 4)}: 1 in 10 fell more than ${sgnPct(
                  simple(dist.quantiles.q10),
                )}, 1 in 10 rose more than ${sgnPct(simple(dist.quantiles.q90))}. Orange bars hold an episode.`,
                `Todas as ${f.num(dist.n)} janelas de ${h} meses iniciadas em ${dist.first.slice(0, 4)}–${dist.last_start.slice(0, 4)}: 1 em 10 caiu mais de ${sgnPct(
                  simple(dist.quantiles.q10),
                )}, 1 em 10 subiu mais de ${sgnPct(simple(dist.quantiles.q90))}. As barras laranja contêm um episódio.`,
              )}
            </p>
            <ChartData
              testId="stress-data"
              caption={t(`Histogram of ${h}-month CBOT moves`, `Histograma dos movimentos da CBOT em ${h} meses`)}
              columns={[t("Move", "Movimento"), t("Windows", "Janelas"), t("Episodes", "Episódios")]}
              rows={dist.counts.map((c, i) => [
                `${sgnPct(simple(edges[i]))} ${t("to", "a")} ${sgnPct(simple(edges[i + 1]))}`,
                f.num(c),
                sh.episodes
                  .filter((e) => binOfLr(e.logret) === i)
                  .map((e) => d(e.name))
                  .join(", ") || "—",
              ])}
            />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          {d(stress.rule)} * {d(stress.basis)}
          {stress.basis.endsWith(".") ? "" : "."}{" "}
          {t(
            `Rank: the move's percentile among all ${h}-month windows (p5 = only 5% of windows moved lower).`,
            `Posição: o percentil do movimento entre todas as janelas de ${h} meses (p5 = só 5% das janelas caíram mais).`,
          )}
        </p>
      </div>
  );
}
