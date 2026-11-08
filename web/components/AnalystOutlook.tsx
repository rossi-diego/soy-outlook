"use client";

// The analyst view of today's outlook, moved off the home page in the story redesign and shown on
// /track-record/ under "For analysts" (loaded on first open): the per-horizon cards with the hedge
// contract and roll flag, "How to read these ranges" (95% range, hit-rate uncertainty, tails, rolls
// and notes), the full budgeting and hedging panel (1 in 40, sacks, currency, target-price
// readout, tail flags) and the stress replay. It has its own unit, premium and FX controls.
import DecisionPanel from "@/components/DecisionPanel";
import { PriceHeadline, SettingsControls, useIssuedLabel, useOutlookSettings } from "@/components/OutlookSettings";
import StressReplay from "@/components/StressReplay";
import { type Assumptions, convert, decimalsFor, premiumUsdT, type Unit } from "@/lib/format";
import type { Horizon, Meta, Outlook } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

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

/** The validation-era split alone: the one hit rate a card shows up front. */
const validationOnly = (cov: Horizon["coverage"]) => ({ ...cov, holdout: null });

/**
 * One horizon, progressive disclosure (unit B): the 80% range, one measured-hit-rate pill, the
 * central value and the hedge contract. Everything else is in the shared "How to read these
 * ranges" fold under the cards.
 */
function HorizonCard({
  h,
  unit,
  a,
  local,
  fob,
}: {
  h: Horizon;
  unit: Unit;
  a: Assumptions;
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
        <p className="text-xs text-muted" data-testid="label80">
          {t(`${f.pct(cov.nominal["80"])} range`, `Faixa de ${f.pct(cov.nominal["80"])}`)}, {f.unit(unit)}
        </p>
        <p className="tabular text-2xl font-semibold tracking-tight lg:text-3xl">
          {f.num(c(h.q100), dec)} – {f.num(c(h.q900), dec)}
        </p>
        <p className="mt-1.5">
          <span
            data-testid="hit80"
            title={t(
              "Share of past forecasts whose outcome landed inside the 80% range, validation reports",
              "Parcela das previsões passadas cujo resultado caiu dentro da faixa de 80%, relatórios de validação",
            )}
            className={`inline-block rounded-full border px-2 py-px text-xs font-medium leading-5 ${
              cov.warn80 ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2"
            }`}
          >
            {f.held(validationOnly(cov), "80")}
            {cov.warn80 && <span>, {t("below 80%", "abaixo de 80%")}</span>}
          </span>
        </p>
        {unit !== "c_bu" && (
          <p className="mt-1.5 text-xs text-muted" data-testid="basis-label">
            {basisNote(t, unit, fob)}
          </p>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-sm">
        <dt className="text-ink-2">{t("Central", "Central")}</dt>
        <dd className="tabular text-right">
          {f.money(c(h.central), unit)}
          {isRw && <span className="block text-xs text-muted">{t("CBOT unchanged", "CBOT sem variação")}</span>}
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
        </dd>
        {unit !== "c_bu" && fob && (
          <>
            <dt className="text-ink-2">{t("Your premium", "Seu prêmio")}</dt>
            <dd className="tabular text-right text-ink-2" data-testid="premium-row">
              {f.signed0(a.premium)}¢/bu
              <span className="block text-xs text-muted">
                {t(
                  `FOB = CBOT + your premium (${f.signed0(usdT(a.premium))} USD/t), held flat`,
                  `FOB = CBOT + o seu prêmio (${f.signed0(usdT(a.premium))} USD/t), constante`,
                )}
              </span>
            </dd>
            {unit === "brl_sack" && local && (
              <>
                <dt className="text-ink-2">{t("Your discount", "Seu desconto")}</dt>
                <dd className="tabular text-right text-ink-2" data-testid="basis-row">
                  −R$ {f.num(a.basis ?? 0, 2)}/sc
                </dd>
              </>
            )}
          </>
        )}
      </dl>
    </article>
  );
}

/**
 * The one shared fold under the cards (unit B): the 95% range, both eras' hit rates and their
 * uncertainty, n_eff, the tail split and counts, the roll details, and every footnote.
 */
function RangeDetails({
  meta,
  outlook,
  unit,
  a,
  fob,
  issued,
}: {
  meta: Meta;
  outlook: Pick<Outlook, "horizons">;
  unit: Unit;
  a: Assumptions;
  fob: boolean;
  issued: string;
}) {
  const { t, f } = useI18n();
  const dec = decimalsFor(unit);
  const c = (v: number) => f.num(convert(v, unit, a), dec);
  const championAllRw = outlook.horizons.every((h) => h.model === "rw");
  const tailNominal = f.pct(meta.intervals.tail_nominal_80);
  return (
    <details className="card p-5 text-sm leading-relaxed text-ink-2" data-testid="ranges-details">
      <summary className="cursor-pointer select-none font-medium text-ink">
        {t("How to read these ranges", "Como ler estas faixas")}
        <span className="ml-2 text-xs font-normal text-muted">
          {t("95% range, hit-rate uncertainty, tails, rolls and notes", "faixa de 95%, incerteza das taxas de acerto, caudas, rolagens e notas")}
        </span>
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {outlook.horizons.map((h) => {
          const cov = h.coverage;
          const v = cov.validation;
          const ci80 = f.ci(v, "80");
          const ci95 = f.ci(v, "95", false);
          const ct = h.contract;
          return (
            <div key={h.h} className="space-y-2 rounded-lg border border-line p-3 text-xs" data-testid={`detail-${h.h}`}>
              <p className="text-sm font-medium text-ink">
                {t("In", "Em")} {f.horizon(h.h)}
              </p>
              <p>
                <span className="font-medium text-ink-2">{f.range(cov, "80")}</span>
                {ci80 && (
                  <span className="block text-muted" data-testid="ci80">
                    {v?.years}: {ci80}
                  </span>
                )}
              </p>
              <p>
                <span className="font-medium text-ink-2">
                  {t("95% range", "Faixa de 95%")}:{" "}
                  <span className="tabular" data-testid="range95">
                    {c(h.q025)} – {c(h.q975)}
                  </span>{" "}
                  {f.unit(unit)}
                </span>
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
                <span className={`block ${cov.warn95 ? "text-warn" : "text-muted"}`} data-testid="held95">
                  {f.held(cov, "95")}
                </span>
                {ci95 && (
                  <span className="block text-muted" data-testid="ci95">
                    {ci95}
                  </span>
                )}
              </p>
              {v && v.miss_lo80 != null && v.miss_hi80 != null && (
                <p data-testid="tail-split">
                  {t(
                    `Outside the 80% range, ${v.years}: ${f.pct(v.miss_lo80)} below, ${f.pct(v.miss_hi80)} above (${tailNominal} each nominal).`,
                    `Fora da faixa de 80%, ${v.years}: ${f.pct(v.miss_lo80)} abaixo, ${f.pct(v.miss_hi80)} acima (${tailNominal} cada, nominal).`,
                  )}
                </p>
              )}
              <p className="text-muted">
                {t(
                  `Hit rates on ${v?.n ?? "—"} validation and ${cov.holdout?.n ?? "—"} later reports. Each 95% tail rests on about ${f.num(h.tail_obs_95, 1)} of the ${h.calibration_n} past errors behind the range (about ${f.num(h.calibration_n_eff, 0)} non-overlapping).`,
                  `Taxas de acerto em ${v?.n ?? "—"} relatórios de validação e ${cov.holdout?.n ?? "—"} posteriores. Cada cauda de 95% se apoia em cerca de ${f.num(h.tail_obs_95, 1)} dos ${h.calibration_n} erros passados por trás da faixa (cerca de ${f.num(h.calibration_n_eff, 0)} sem sobreposição).`,
                )}
              </p>
              <p className="text-muted" data-testid="roll-detail">
                {ct.reference.code}:{" "}
                {ct.crosses_roll
                  ? `${t("price series rolls", "a série de preços passa de")} ${ct.front_at_origin} → ${ct.front_at_target}${
                      ct.crosses_crop_roll ? t(", old to new crop", ", safra velha para safra nova") : ""
                    }`
                  : `${t("price series stays on", "a série de preços fica em")} ${ct.front_at_origin}`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-2 text-xs">
        <p>
          {t(
            <>
              <strong className="font-medium text-ink">The pill</strong> is the share of validation reports ({meta.splits.validation[0].slice(0, 4)}
              –{meta.splits.validation[1].slice(0, 4)}) whose outcome landed inside the 80% range; amber marks one that held more than{" "}
              {f.num(meta.intervals.coverage_warn_pp * 100, 0)} points below its nominal level. The later reports above were never used to
              build or choose anything. Ranges come from the errors of the last {meta.calibration_window} out-of-sample forecasts, so the 95%
              range, whose tails rest on one or two past errors each, is rough.
            </>,
            <>
              <strong className="font-medium text-ink">O selo</strong> é a parcela dos relatórios de validação ({meta.splits.validation[0].slice(0, 4)}
              –{meta.splits.validation[1].slice(0, 4)}) cujo resultado caiu dentro da faixa de 80%; âmbar marca uma faixa que acertou mais de{" "}
              {f.num(meta.intervals.coverage_warn_pp * 100, 0)} pontos abaixo do nível nominal. Os relatórios posteriores acima nunca foram usados
              para construir ou escolher nada. As faixas vêm dos erros das últimas {meta.calibration_window} previsões fora da amostra, então a
              faixa de 95%, cujas caudas se apoiam em um ou dois erros passados cada, é aproximada.
            </>,
          )}
        </p>
        {championAllRw && (
          <p>
            {t(
              <>
                <strong className="font-medium text-ink">Why the central value is today&apos;s price.</strong> Tested on every WASDE since{" "}
                <span data-testid="validation-start">{meta.splits.validation[0].slice(0, 4)}</span>, no model (including one built on WASDE
                revisions) predicted CBOT soybeans better than &ldquo;no change&rdquo;. What this page adds is a tested range labelled with the
                hit rate it actually achieved.
              </>,
              <>
                <strong className="font-medium text-ink">Por que o valor central é o preço de hoje.</strong> Testado em todos os WASDE desde{" "}
                <span data-testid="validation-start">{meta.splits.validation[0].slice(0, 4)}</span>, nenhum modelo (nem um construído com as
                revisões do WASDE) previu a soja na CBOT melhor do que &ldquo;sem variação&rdquo;. O que esta página acrescenta é uma faixa
                testada, rotulada com a taxa de acerto que ela de fato teve.
              </>,
            )}
          </p>
        )}
        <p>
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
        <p>
          {t(
            <>
              Prices are the continuous front month; the hedge contract is the first whose first notice day falls after the target date. A
              window that crosses a roll includes a calendar spread that a hedge in today&apos;s front contract would not capture.
            </>,
            <>
              Os preços são do primeiro vencimento contínuo; o contrato de hedge é o primeiro cujo primeiro dia de aviso cai depois da data-alvo.
              Uma janela que cruza uma rolagem inclui um spread entre vencimentos que um hedge no contrato de hoje não capturaria.
            </>,
          )}
        </p>
        <p data-testid="fob-note">
          {t(
            <>
              FOB is (CBOT + your premium) × {f.num(meta.consts.bu_per_t, 4)} bu/t ÷ 100; with no premium entered, USD/t and R$/sack are the CBOT
              price alone. The ranges cover CBOT price risk only: {fob ? "your premium" : "a premium"} and the exchange rate are held fixed.
              Reais per sack use your exchange rate; with a premium they are port FOB (which includes fobbing, the port loading cost), not a
              farm-gate price.
            </>,
            <>
              FOB = (CBOT + o seu prêmio) × {f.num(meta.consts.bu_per_t, 4)} bu/t ÷ 100; sem prêmio informado, USD/t e R$/saca são só o preço da
              CBOT. As faixas cobrem só o risco de preço da CBOT: {fob ? "o seu prêmio" : "um prêmio"} e o câmbio ficam fixos. Reais por saca
              usam o seu câmbio; com prêmio, são valor FOB no porto (que inclui o fobbing, custo de embarque no porto), não preço na fazenda.
            </>,
          )}
        </p>
      </div>
    </details>
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

export type AnalystData = Pick<Outlook, "as_of_close" | "last" | "horizons" | "stress">;

export default function AnalystOutlook({ meta, outlook }: { meta: Meta; outlook: AnalystData }) {
  const { t } = useI18n();
  const s = useOutlookSettings(meta);
  const issued = useIssuedLabel(meta);
  return (
    <div className="mt-5 space-y-6" data-testid="analyst-outlook">
      <div className="space-y-3">
        <SettingsControls s={s} meta={meta} />
        <PriceHeadline s={s} last={outlook.last.c_bu} className="max-w-3xl text-sm text-muted" />
      </div>
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-3" aria-label={t("Forecast by horizon", "Previsão por horizonte")}>
          {outlook.horizons.map((h) => (
            <HorizonCard key={h.h} h={h} unit={s.unit} a={s.a} local={s.local} fob={s.fob} />
          ))}
        </section>
        <RangeDetails meta={meta} outlook={outlook} unit={s.unit} a={s.a} fob={s.fob} issued={issued} />
      </div>
      <DecisionPanel
        horizons={outlook.horizons}
        p0={outlook.last.c_bu}
        buPerT={meta.consts.bu_per_t}
        sackKg={meta.consts.sack_kg}
        fx={s.fx}
        unit={s.unit}
        a={s.a}
        readoutLevels={meta.intervals.target_readout_levels}
        tailObsMin={meta.intervals.tail_obs_min_95}
      />
      <StressReplay stress={outlook.stress} buPerT={meta.consts.bu_per_t} />
    </div>
  );
}
