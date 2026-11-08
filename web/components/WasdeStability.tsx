"use client";

import { stabilityFacts } from "@/lib/stability";
import type { Wasde } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

type Reaction = Wasde["reaction"];

/**
 * "How stable is this?" (polish unit D): the event study's own robustness checks, already in
 * wasde.json, in plain language first and as one compact table second. Every sentence is
 * conditional on the published numbers, so the copy cannot outlive the data.
 */
export default function WasdeStability({ reaction }: { reaction: Reaction }) {
  const { t, f, d } = useI18n();
  const s = stabilityFacts(reaction);
  const rob = reaction.robustness;
  const split = rob.split_sample;
  const yrs = (y: string) => y.replace("-", "–");
  const c2 = (v: number) => (Math.abs(v) < 0.005 ? f.num(0, 2) : f.signed(v, 2));
  const pF = (v: number) => (v < 0.001 ? `<${f.num(0.001, 3)}` : f.num(v, 3));
  const per = `USD/t ${t("per", "por")} ${s.unit}`;
  const line = d(s.label);

  const splitSentence = s.broke
    ? s.late.zero
      ? t(
          `The ${line} effect is concentrated before ${s.breakYear} and is not distinguishable from zero after: ${c2(s.early.b)} ${per} in ${yrs(
            s.early.years,
          )} against ${c2(s.late.b)} ± ${f.num(s.late.se, 2)} since ${s.breakYear} (difference p ${pF(s.diffP)}).`,
          `O efeito de “${line}” se concentra antes de ${s.breakYear} e não é distinguível de zero depois: ${c2(s.early.b)} ${per} em ${yrs(
            s.early.years,
          )} contra ${c2(s.late.b)} ± ${f.num(s.late.se, 2)} desde ${s.breakYear} (p da diferença ${pF(s.diffP)}).`,
        )
      : t(
          `The ${line} effect changed size at ${s.breakYear}: ${c2(s.early.b)} ${per} in ${yrs(s.early.years)} against ${c2(s.late.b)} ± ${f.num(
            s.late.se,
            2,
          )} since then (difference p ${pF(s.diffP)}).`,
          `O efeito de “${line}” mudou de tamanho em ${s.breakYear}: ${c2(s.early.b)} ${per} em ${yrs(s.early.years)} contra ${c2(
            s.late.b,
          )} ± ${f.num(s.late.se, 2)} desde então (p da diferença ${pF(s.diffP)}).`,
        )
    : t(
        `The ${line} effect is similar before and after ${s.breakYear}: ${c2(s.early.b)} against ${c2(s.late.b)} ${per} (difference p ${pF(s.diffP)}).`,
        `O efeito de “${line}” é parecido antes e depois de ${s.breakYear}: ${c2(s.early.b)} contra ${c2(s.late.b)} ${per} (p da diferença ${pF(
          s.diffP,
        )}).`,
      );

  const rollSentence = s.roll.jointZero
    ? t(
        `Excluding the ${s.roll.nExcluded} release days within ${s.roll.bdays} business days of a contract expiry also removes it (${c2(s.roll.b)} ± ${f.num(
          s.roll.se,
          2,
        )}), and the six revisions together are no longer distinguishable from zero (joint p ${pF(s.roll.jointP)}, ${s.roll.nLeft} reports left).`,
        `Excluir os ${s.roll.nExcluded} dias de divulgação a até ${s.roll.bdays} dias úteis do vencimento de um contrato também o remove (${c2(
          s.roll.b,
        )} ± ${f.num(s.roll.se, 2)}), e as seis revisões juntas deixam de ser distinguíveis de zero (p conjunto ${pF(s.roll.jointP)}, ${
          s.roll.nLeft
        } relatórios restantes).`,
      )
    : t(
        `Excluding the ${s.roll.nExcluded} release days within ${s.roll.bdays} business days of a contract expiry leaves a joint effect (joint p ${pF(
          s.roll.jointP,
        )}, ${s.roll.nLeft} reports left); this line becomes ${c2(s.roll.b)} ± ${f.num(s.roll.se, 2)}.`,
        `Excluir os ${s.roll.nExcluded} dias de divulgação a até ${s.roll.bdays} dias úteis do vencimento de um contrato mantém um efeito conjunto (p conjunto ${pF(
          s.roll.jointP,
        )}, ${s.roll.nLeft} relatórios restantes); esta linha passa a ${c2(s.roll.b)} ± ${f.num(s.roll.se, 2)}.`,
      );

  const placeboSentence = s.placebo.clean
    ? t(
        `A placebo window ${s.placebo.lag} sessions before each report finds nothing (joint p ${pF(s.placebo.jointP)}), so the full-sample fit is not a pre-report drift.`,
        `Uma janela placebo ${s.placebo.lag} sessões antes de cada relatório não encontra nada (p conjunto ${pF(s.placebo.jointP)}), então o ajuste com a amostra toda não é uma deriva anterior ao relatório.`,
      )
    : t(
        `A placebo window ${s.placebo.lag} sessions before each report also finds an effect (joint p ${pF(s.placebo.jointP)}): treat the release-day fit with extra caution.`,
        `Uma janela placebo ${s.placebo.lag} sessões antes de cada relatório também encontra efeito (p conjunto ${pF(s.placebo.jointP)}): trate o ajuste do dia da divulgação com cautela extra.`,
      );

  const rows = reaction.features.map((feat) => {
    const full = reaction.items.find((it) => it.feature === feat)!;
    const sp = split.items.find((it) => it.feature === feat)!;
    const ro = rob.roll_excluded.items.find((it) => it.feature === feat)!;
    const pl = rob.placebo.items.find((it) => it.feature === feat)!;
    return { feat, full, sp, ro, pl };
  });
  const H = {
    line: t("Revision (per unit)", "Revisão (por unidade)"),
    full: t(`All reports ${yrs(reaction.years)}`, `Todos ${yrs(reaction.years)}`),
    early: yrs(split.early.years),
    late: yrs(split.late.years),
    diff: t("Difference p", "p da diferença"),
    roll: t("Expiry days excluded", "Sem dias de vencimento"),
    placebo: t(`Placebo (${s.placebo.lag} sessions before)`, `Placebo (${s.placebo.lag} sessões antes)`),
  };
  const cell = (b: number, se: number) => `${c2(b)} ± ${f.num(se, 2)}`;

  return (
    <section className="card space-y-3 p-5" aria-labelledby="stability-title" data-testid="stability">
      <h2 id="stability-title" className="text-lg font-semibold">
        {t("How stable is this?", "Quão estável é isso?")}
      </h2>
      <div className="max-w-3xl space-y-2 text-sm leading-relaxed text-ink-2" data-testid="stability-summary">
        <p>
          <strong className="text-ink">{splitSentence}</strong> {rollSentence}
        </p>
        <p>
          {placeboSentence}{" "}
          {t(
            `That is why the what-if below opens on the ${yrs(split.late.years)} fit (${split.late.n_reports} reports), with the full sample one click away. This display rule was fixed in config.py on 8 Nov 2026; the coefficients themselves are not re-chosen.`,
            `Por isso a simulação abaixo abre no ajuste de ${yrs(split.late.years)} (${split.late.n_reports} relatórios), com a amostra toda a um clique. Esta regra de exibição foi fixada no config.py em 8 nov 2026; os coeficientes em si não são reescolhidos.`,
          )}
        </p>
      </div>
      <details className="text-sm" data-testid="stability-details">
        <summary className="cursor-pointer font-medium text-ink">
          {t("All six revisions, every check", "As seis revisões, todas as verificações")}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="stack-sm w-full min-w-[44rem] text-sm" data-testid="stability-table">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">{H.line}</th>
                <th className="py-2 text-right font-medium">{H.full}</th>
                <th className="py-2 text-right font-medium">{H.early}</th>
                <th className="py-2 text-right font-medium">{H.late}</th>
                <th className="py-2 text-right font-medium">{H.diff}</th>
                <th className="py-2 text-right font-medium">{H.roll}</th>
                <th className="py-2 text-right font-medium">{H.placebo}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ feat, full, sp, ro, pl }) => (
                <tr key={feat} className="border-b border-line" data-feature={feat}>
                  <td className="py-2">
                    {d(full.label)} ({full.unit})
                  </td>
                  <td data-label={H.full} className="tabular py-2 text-right">
                    {cell(full.usd_t_per_unit, full.se_usd_t)}
                  </td>
                  <td data-label={H.early} className="tabular py-2 text-right">
                    {cell(sp.early_usd_t, sp.early_se_usd_t)}
                  </td>
                  <td data-label={H.late} className="tabular py-2 text-right">
                    {cell(sp.late_usd_t, sp.late_se_usd_t)}
                  </td>
                  <td data-label={H.diff} className={`tabular py-2 text-right ${sp.diff_p < reaction.alpha ? "font-semibold text-ink" : ""}`}>
                    {pF(sp.diff_p)}
                  </td>
                  <td data-label={H.roll} className="tabular py-2 text-right">
                    {cell(ro.usd_t_per_unit, ro.se_usd_t)}
                  </td>
                  <td data-label={H.placebo} className="tabular py-2 text-right">
                    {cell(pl.usd_t_per_unit, pl.se_usd_t)}
                  </td>
                </tr>
              ))}
              <tr className="font-medium" data-testid="stability-joint">
                <td className="py-2">{t("Joint p, all six", "p conjunto, as seis")}</td>
                <td data-label={H.full} className="tabular py-2 text-right">
                  {pF(reaction.joint_p)}
                </td>
                <td data-label={H.early} className="tabular py-2 text-right">
                  {pF(split.early.joint_p)}
                </td>
                <td data-label={H.late} className="tabular py-2 text-right">
                  {pF(split.late.joint_p)}
                </td>
                <td data-label={H.diff} className="py-2 text-right text-muted">
                  —
                </td>
                <td data-label={H.roll} className="tabular py-2 text-right">
                  {pF(rob.roll_excluded.joint_p)}
                </td>
                <td data-label={H.placebo} className="tabular py-2 text-right">
                  {pF(rob.placebo.joint_p)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          {t(
            `Coefficient ± one standard error (HC1), USD/t per unit at today's price. Reports: ${reaction.n_reports} in all, ${split.early.n_reports} before and ${split.late.n_reports} from ${s.breakYear}; ${s.roll.nLeft} after dropping the ${s.roll.nExcluded} days near an expiry, which also costs power, so that null is partly a smaller sample. Difference p: two-sided z-test on the gap between the two halves.`,
            `Coeficiente ± um erro-padrão (HC1), USD/t por unidade ao preço de hoje. Relatórios: ${reaction.n_reports} no total, ${split.early.n_reports} antes e ${split.late.n_reports} a partir de ${s.breakYear}; ${s.roll.nLeft} depois de tirar os ${s.roll.nExcluded} dias perto de um vencimento, o que também reduz o poder do teste, então esse resultado nulo em parte reflete a amostra menor. p da diferença: teste z bilateral da distância entre as duas metades.`,
          )}
        </p>
      </details>
    </section>
  );
}
