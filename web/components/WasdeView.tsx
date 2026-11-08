"use client";

import ReleaseMoveBand from "@/components/ReleaseMoveBand";
import WasdeWhatIf from "@/components/WasdeWhatIf";
import type { Wasde } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

/** The /wasde/ page body; a client component so the copy follows the locale toggle (P20). */
export default function WasdeView({ w, p0UsdT, buPerT }: { w: Wasde; p0UsdT: number; buPerT: number }) {
  const { t, f, d } = useI18n();
  const mv = w.reaction.release_move;
  const prev = f.month(w.previous_month);
  const cur = f.month(w.report_month);
  const lineValue = (v: number | null, unit: string) => (v === null ? "—" : `${f.num(v, 1)} ${unit}`);
  const lineChange = (c: number | null, unit: string) =>
    c === null ? t("new MY", "novo ano-safra") : Math.abs(c) < 0.005 ? f.signed(0) : `${f.signed(c, unit === "%" ? 2 : 1)} ${unit === "%" ? "pp" : unit}`;
  const forwardFeatures = Array.from(new Set(w.forward.filter((x) => x.feature.startsWith("rev_")).map((x) => x.feature)));
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">
          {t(
            `${cur} WASDE · released ${f.date(w.release_date, "long")} · marketing year ${w.market_year}`,
            `WASDE de ${cur} · divulgado em ${f.date(w.release_date, "long")} · ano-safra ${w.market_year}`,
          )}
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">
          {t("What did the latest WASDE change, and what is that worth?", "O que o último WASDE mudou, e quanto isso vale?")}
        </h1>
        <p className="max-w-3xl text-ink-2">
          {t(
            "USDA publishes at 12:00 ET and CBOT soybeans close at 13:20 CT, so the market prices a report the same day. Below: the lines that matter for soybeans and the historical average reaction to each revision.",
            "O USDA publica às 12:00 ET e a soja na CBOT fecha às 13:20 CT, então o mercado precifica o relatório no mesmo dia. Abaixo: as linhas que importam para a soja e a reação média histórica a cada revisão.",
          )}
        </p>
        {w.next_release && (
          <p className="max-w-3xl text-sm text-ink-2">
            <strong className="text-ink">
              {t("Next WASDE", "Próximo WASDE")} ({f.date(w.next_release)}):
            </strong>{" "}
            {t(
              `typical release-day move ±${f.num(mv.typical_usd_t, 1)} USD/t; 1 report in 10 moves more than ±${f.num(mv.one_in_ten_usd_t, 1)} USD/t (${
                mv.n
              } reports, ${w.reaction.years}; the 1-in-10 band held ${f.pct(mv.hit_rate.all.hit90)} of ${mv.hit_rate.all.n} reports out of sample).`,
              `movimento típico no dia da divulgação de ±${f.num(mv.typical_usd_t, 1)} USD/t; 1 relatório em 10 move mais de ±${f.num(
                mv.one_in_ten_usd_t,
                1,
              )} USD/t (${mv.n} relatórios, ${w.reaction.years}; a banda de 1 em 10 acertou ${f.pct(mv.hit_rate.all.hit90)} de ${
                mv.hit_rate.all.n
              } relatórios fora da amostra).`,
            )}
          </p>
        )}
      </section>

      <ReleaseMoveBand move={mv} p0UsdT={p0UsdT} nextRelease={w.next_release} />

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-lg font-semibold">
          {t(`Projected ${w.market_year}: ${cur} vs ${prev}`, `Projeção ${w.market_year}: ${cur} contra ${prev}`)}
        </h2>
        <table className="stack-sm w-full min-w-[30rem] text-sm" data-testid="wasde-lines">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">{t("Line", "Linha")}</th>
              <th className="py-2 text-right font-medium">{prev}</th>
              <th className="py-2 text-right font-medium">{cur}</th>
              <th className="py-2 text-right font-medium">{t("Change", "Variação")}</th>
            </tr>
          </thead>
          <tbody>
            {w.lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-2">{d(l.label)}</td>
                <td data-label={prev} className="tabular py-2 text-right text-ink-2">
                  {lineValue(l.previous, l.unit)}
                </td>
                <td data-label={cur} className="tabular py-2 text-right">
                  {lineValue(l.value, l.unit)}
                </td>
                <td data-label={t("Change", "Variação")} className="tabular py-2 text-right">
                  {lineChange(l.change, l.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          {t("Stocks-to-use = ending stocks ÷ total use. Full balance sheets:", "Estoque/uso = estoques finais ÷ uso total. Balanços completos:")}{" "}
          <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app/commodity/soybeans/">
            WASDE Tracker
          </a>
          .
        </p>
      </section>

      <WasdeWhatIf reaction={w.reaction} buPerT={buPerT} />

      <section className="card space-y-3 p-5 text-sm leading-relaxed text-ink-2">
        <h2 className="text-lg font-semibold text-ink">{t("And after release day?", "E depois do dia da divulgação?")}</h2>
        <p>
          {t(
            "The same revisions were also tested as predictors of the price 1, 3 and 6 months later. Out of sample they did not beat “no change” at any horizon, and in-sample none of the estimates below is distinguishable from zero at the usual 5% level. That is what an efficient market looks like: the news is in the price by the close.",
            "As mesmas revisões também foram testadas como preditoras do preço 1, 3 e 6 meses depois. Fora da amostra não superaram o “sem variação” em nenhum horizonte e, dentro da amostra, nenhuma das estimativas abaixo é distinguível de zero ao nível usual de 5%. É assim que um mercado eficiente se parece: a notícia já está no preço no fechamento.",
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="stack-sm w-full min-w-[30rem]" data-testid="wasde-forward">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">{t("Revision (per unit)", "Revisão (por unidade)")}</th>
                {[1, 3, 6].map((h) => (
                  <th key={h} className="py-2 text-right font-medium">
                    {t(`${h}m later, USD/t`, `${h}m depois, USD/t`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {forwardFeatures.map((feat) => {
                const rows = w.forward.filter((x) => x.feature === feat);
                return (
                  <tr key={feat} className="border-b border-line last:border-0">
                    <td className="py-2">
                      {d(rows[0].label.replace("Revision: ", ""))} ({rows[0].unit})
                    </td>
                    {[1, 3, 6].map((h) => {
                      const r = rows.find((x) => x.h === h);
                      return (
                        <td key={h} data-label={t(`${h}m later, USD/t`, `${h}m depois, USD/t`)} className="tabular py-2 text-right">
                          {r ? `${f.signed(r.usd_t_per_unit, 1)} ± ${f.num(r.se_usd_t, 1)}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          {t("Estimate ± one standard error (HAC), all reports since July 2010.", "Estimativa ± um erro-padrão (HAC), todos os relatórios desde julho de 2010.")}
        </p>
      </section>
    </div>
  );
}
