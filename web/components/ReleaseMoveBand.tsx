"use client";

import type { ReleaseMove as Move } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

/** The empirical release-day move band (P14), drawn as a range around today's CBOT close. */
export default function ReleaseMoveBand({ move, p0UsdT, nextRelease }: { move: Move; p0UsdT: number; nextRelease: string | null }) {
  const { t, f } = useI18n();
  const num = f.num;
  // Position in % of the strip: the 1-in-10 band spans the middle 76%, centred on today.
  const span = move.one_in_ten_usd_t / 0.38;
  const x = (d: number) => 50 + (d / span) * 100;
  const v = move.hit_rate.validation;
  const ho = move.hit_rate.holdout;
  return (
    <section className="card space-y-4 p-5" aria-labelledby="move-title" data-testid="release-move">
      <div className="space-y-1">
        <h2 id="move-title" className="text-lg font-semibold">
          {t("How far does CBOT move on a WASDE day?", "Quanto a CBOT se move num dia de WASDE?")}
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          {t(
            `The size of the release-day move (${move.n} reports), with no direction: drawn around today's CBOT price of ${num(p0UsdT, 0)} USD/t${
              nextRelease ? `, as a guide for the ${f.date(nextRelease)} report` : ""
            }.`,
            `O tamanho do movimento no dia da divulgação (${move.n} relatórios), sem direção: desenhado em torno do preço de hoje na CBOT, ${num(
              p0UsdT,
              0,
            )} USD/t${nextRelease ? `, como guia para o relatório de ${f.date(nextRelease)}` : ""}.`,
          )}
        </p>
      </div>
      <div
        className="relative mx-auto h-24 max-w-3xl"
        role="img"
        aria-label={t(
          `Typical release-day move plus or minus ${num(move.typical_usd_t, 1)} USD per tonne around today's ${num(p0UsdT, 0)}; 1 report in 10 moves more than plus or minus ${num(move.one_in_ten_usd_t, 1)}`,
          `Movimento típico no dia da divulgação de mais ou menos ${num(move.typical_usd_t, 1)} USD por tonelada em torno dos ${num(p0UsdT, 0)} de hoje; 1 relatório em 10 move mais de mais ou menos ${num(move.one_in_ten_usd_t, 1)}`,
        )}
        data-testid="move-band"
      >
        <span className="tabular absolute top-0 -translate-x-1/2 text-xs text-ink-2" style={{ left: "50%" }}>
          {t("today", "hoje")} {num(p0UsdT, 0)} USD/t
        </span>
        <div
          className="absolute top-6 h-7 rounded-md"
          style={{ left: `${x(-move.one_in_ten_usd_t)}%`, width: `${x(move.one_in_ten_usd_t) - x(-move.one_in_ten_usd_t)}%`, background: "var(--accent-soft)" }}
        />
        <div
          className="absolute top-6 h-7 rounded-md"
          style={{ left: `${x(-move.typical_usd_t)}%`, width: `${x(move.typical_usd_t) - x(-move.typical_usd_t)}%`, background: "var(--accent)", opacity: 0.85 }}
        />
        <div className="absolute top-4 h-11 w-0.5 -translate-x-1/2 bg-ink" style={{ left: "50%" }} />
        {[-1, 1].flatMap((sg) =>
          [
            [move.typical_usd_t, "text-ink-2"],
            [move.one_in_ten_usd_t, "text-muted"],
          ].map(([d, cls]) => (
            <span
              key={`${sg}-${d}`}
              className={`tabular absolute top-[3.75rem] -translate-x-1/2 text-center text-xs leading-tight ${cls}`}
              style={{ left: `${x(sg * Number(d))}%` }}
            >
              {sg < 0 ? "−" : "+"}
              {num(Number(d), 1)}
              <span className="block text-[0.65rem] text-muted">{num(p0UsdT + sg * Number(d), 0)}</span>
            </span>
          )),
        )}
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="flex items-center gap-2 font-medium text-ink">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--accent)" }} aria-hidden />
            {t("Typical move", "Movimento típico")}: ±{num(move.typical_usd_t, 1)} USD/t (±{num(move.typical_pct, 2)}%)
          </dt>
          <dd className="text-ink-2" data-testid="move-hit50">
            {t(
              `Half of reports should stay inside. Out of sample it held ${f.moveHit(v, "50")}, and ${f.moveHit(ho, "50")}.`,
              `Metade dos relatórios deveria ficar dentro. Fora da amostra acertou ${f.moveHit(v, "50")}, e ${f.moveHit(ho, "50")}.`,
            )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="flex items-center gap-2 font-medium text-ink">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--accent-soft)" }} aria-hidden />
            {t("1 in 10 moves more than", "1 em 10 move mais de")} ±{num(move.one_in_ten_usd_t, 1)} USD/t (±{num(move.one_in_ten_pct, 2)}%)
          </dt>
          <dd className="text-ink-2" data-testid="move-hit90">
            {t(
              `Nine reports in ten should stay inside. Out of sample it held ${f.moveHit(v, "90")}, and ${f.moveHit(ho, "90")}.`,
              `Nove em cada dez relatórios deveriam ficar dentro. Fora da amostra acertou ${f.moveHit(v, "90")}, e ${f.moveHit(ho, "90")}.`,
            )}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted">
        {t(
          `Band: the median and 90th percentile of the absolute release-day log return over every usable report since 2010 (May reports and reports without a session on the day excluded), in USD/t at today's price. Hit rate: each report from ${v.years.slice(
            0,
            4,
          )} on is scored against the band built from earlier reports only (at least ${move.min_past}); ranges are Wilson 95% intervals. A volatility model (EWMA, HAR-RV) is pre-registered for v2 and replaces this band only if it beats it out of sample.`,
          `Banda: a mediana e o percentil 90 do log-retorno absoluto no dia da divulgação, em todos os relatórios utilizáveis desde 2010 (excluídos os de maio e os sem pregão no dia), em USD/t ao preço de hoje. Taxa de acerto: cada relatório a partir de ${v.years.slice(
            0,
            4,
          )} é avaliado contra a banda construída só com relatórios anteriores (no mínimo ${move.min_past}); os intervalos são de Wilson, 95%. Um modelo de volatilidade (EWMA, HAR-RV) está pré-registrado para a v2 e só substitui esta banda se a superar fora da amostra.`,
        )}
      </p>
    </section>
  );
}
