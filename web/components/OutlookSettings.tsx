"use client";

// Price unit, Paranaguá premium, exchange rate and port-to-interior discount: one state hook and
// one set of controls, shared by the home page's Settings disclosure and the analyst section on
// /track-record/. The premium is the viewer's input only (lib/premium.ts: no shipped data, no
// default, kept in this browser); FX and the discount are typed as text and parsed on blur.
import { useState } from "react";

import RadioGroup from "@/components/RadioGroup";
import { type Assumptions, convert, parseBasis, parseFx, type Unit } from "@/lib/format";
import { issuedLabel } from "@/lib/issued";
import { parsePremium, premiumInputText, usePremium } from "@/lib/premium";
import type { Meta } from "@/lib/types";
import { useI18n } from "@/lib/useI18n";

export type Settings = ReturnType<typeof useOutlookSettings>;

/** All the settings state. R$/sack is the default unit only under pt-BR; an explicit choice wins. */
export function useOutlookSettings(meta: Meta) {
  const { f, pt } = useI18n();
  const [unitChoice, setUnit] = useState<Unit | null>(null);
  const unit: Unit = unitChoice ?? (pt ? "brl_sack" : "usd_t");
  const [premiumInput, setPremiumInput] = usePremium();
  const fob = premiumInput !== null;
  const premium = premiumInput ?? 0;
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
  // The discount only makes sense on a FOB price, so it needs a premium too.
  const basisOn = unit === "brl_sack" && fob;
  const local = basisOn && basis > 0;
  const base = { fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg, basis: basisOn ? basis : 0 };
  /** Today's assumptions: one premium for the headline and every horizon. */
  const a: Assumptions = { ...base, premium };
  return {
    unit,
    setUnit,
    fob,
    premium,
    fx,
    basis,
    basisOn,
    local,
    a,
    premiumField: { shown: premiumShown, setText: setPremiumText, error: premiumError, commit: commitPremium },
    fxField: { shown: fxShown, setText: setFxText, error: fxError, commit: commitFx },
    basisField: { shown: basisText, setText: setBasisText, error: basisError, commit: commitBasis },
  };
}

/** Unit options; USD/t and R$/sack are FOB only once the user enters a premium. */
export function useUnitOptions(fob: boolean): { id: Unit; label: string; short: string }[] {
  const { t } = useI18n();
  // Short labels on phones (P27) are a substring of the full name, which stays the accessible name.
  const b = fob ? "FOB" : "CBOT";
  return [
    { id: "usd_t", label: `${b} USD/t`, short: "USD/t" },
    { id: "brl_sack", label: t(`${b} R$/sack`, `${b} R$/saca`), short: t("R$/sack", "R$/saca") },
    { id: "c_bu", label: "CBOT ¢/bu", short: "¢/bu" },
  ];
}

const inputCls = (err: string | null) =>
  `tabular w-full rounded-md border bg-page px-2 py-1.5 font-mono text-sm ${err ? "border-warn-line" : "border-line"}`;

/** The controls: unit, premium (not for ¢/bu), FX (R$/sack only) and the optional discount. */
export function SettingsControls({ s, meta }: { s: Settings; meta: Meta }) {
  const { t, f } = useI18n();
  const options = useUnitOptions(s.fob);
  const label = "block text-xs font-medium uppercase tracking-wide text-muted";
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4" data-testid="settings-controls">
      <div className="space-y-1">
        <p className={label}>{t("Show prices as", "Mostrar preços em")}</p>
        <RadioGroup legend={t("Price unit", "Unidade de preço")} value={s.unit} onChange={s.setUnit} options={options} />
      </div>
      {s.unit !== "c_bu" && (
        <div className="w-full max-w-sm space-y-1 sm:w-72" data-testid="premium-input">
          <label htmlFor="premium" className={label}>
            {t("Paranaguá premium, ¢/bu (optional)", "Prêmio de Paranaguá, ¢/bu (opcional)")}
          </label>
          <div className="flex gap-2">
            <input
              id="premium"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder={t("e.g. 80 or -12", "ex.: 80 ou -12")}
              value={s.premiumField.shown}
              onChange={(e) => s.premiumField.setText(e.target.value)}
              onBlur={() => s.premiumField.commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") s.premiumField.commit();
              }}
              aria-invalid={s.premiumField.error !== null}
              aria-describedby="premium-help"
              className={inputCls(s.premiumField.error)}
            />
            {s.fob && (
              <button
                type="button"
                className="shrink-0 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                onClick={() => s.premiumField.commit("")}
              >
                {t("Clear", "Limpar")}
              </button>
            )}
          </div>
          <p
            id="premium-help"
            className={`text-xs ${s.premiumField.error ? "font-medium text-warn" : "text-muted"}`}
            role={s.premiumField.error ? "alert" : undefined}
            data-testid="premium-help"
          >
            {s.premiumField.error
              ? `${s.premiumField.error} ${
                  s.fob ? t(`Using ${f.signed0(s.premium)}¢/bu.`, `Usando ${f.signed0(s.premium)}¢/bu.`) : t("Showing CBOT only.", "Mostrando só CBOT.")
                }`
              : t(
                  "Enter your broker's Paranaguá premium in ¢/bu vs the named CBOT contract. Empty = CBOT only; kept in this browser only.",
                  "Informe o prêmio de Paranaguá do seu corretor em ¢/bu sobre o contrato CBOT indicado. Vazio = só CBOT; fica salvo só neste navegador.",
                )}
          </p>
        </div>
      )}
      {s.unit === "brl_sack" && (
        <div className="w-44 space-y-1">
          <label htmlFor="fx" className={label}>
            {t("BRL per USD", "Reais por dólar")}
          </label>
          <input
            id="fx"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={s.fxField.shown}
            onChange={(e) => s.fxField.setText(e.target.value)}
            onBlur={s.fxField.commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") s.fxField.commit();
            }}
            aria-invalid={s.fxField.error !== null}
            aria-describedby="fx-help"
            className={inputCls(s.fxField.error)}
          />
          {s.fxField.error ? (
            <p id="fx-help" className="text-xs font-medium text-warn" role="alert" data-testid="fx-error">
              {s.fxField.error} {t("Using", "Usando")} {f.num(s.fx, 2)}.
            </p>
          ) : (
            <p id="fx-help" className="text-xs text-muted">
              PTAX {f.date(meta.fx_default.date)}: {f.num(meta.fx_default.value, 4)}
            </p>
          )}
        </div>
      )}
      {s.basisOn && (
        <div className="w-full max-w-sm space-y-1 sm:w-64">
          <label htmlFor="basis" className={label}>
            {t("Port-to-interior discount (R$/sack)", "Desconto porto-interior (R$/sc)")}
          </label>
          <input
            id="basis"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={s.basisField.shown}
            onChange={(e) => s.basisField.setText(e.target.value)}
            onBlur={s.basisField.commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") s.basisField.commit();
            }}
            aria-invalid={s.basisField.error !== null}
            aria-describedby="basis-help"
            className={inputCls(s.basisField.error)}
          />
          <p id="basis-help" className={`text-xs ${s.basisField.error ? "font-medium text-warn" : "text-muted"}`} role={s.basisField.error ? "alert" : undefined}>
            {s.basisField.error
              ? `${s.basisField.error} ${t("Using", "Usando")} ${f.num(s.basis, 2)}.`
              : t(
                  "Optional, your own number (freight, fobbing and local discount); there is no sourced regional default. 0 = port FOB.",
                  "Opcional, número seu (frete, fobbing e desconto local); não há padrão regional com fonte. 0 = FOB no porto.",
                )}
          </p>
        </div>
      )}
    </div>
  );
}

/** Today's price as a sum: CBOT, plus the viewer's premium and minus their discount when entered. */
export function PriceHeadline({ s, last, className = "" }: { s: Settings; last: number; className?: string }) {
  const { t, f } = useI18n();
  const { unit, fob, local, premium, basis, fx, a } = s;
  const fobWord = local ? t("est. local price", "preço estimado na sua praça") : "FOB";
  const atFx =
    unit === "brl_sack" ? (
      <>
        {" "}
        {t("at", "a")} {f.num(fx, 2)} BRL/USD
      </>
    ) : null;
  return (
    <p className={className} data-testid="headline">
      {t("Today:", "Hoje:")}{" "}
      {unit === "c_bu" ? (
        <>
          {t("CBOT soybeans closed at", "a soja na CBOT fechou a")} <strong className="text-ink-2">{f.money(last, "c_bu")}</strong>.
        </>
      ) : !fob ? (
        <>
          {t("CBOT soybeans closed at", "a soja na CBOT fechou a")} <strong className="text-ink-2">{f.money(last, "c_bu")}</strong> ={" "}
          <strong className="text-ink-2">{f.money(convert(last, unit, a), unit)}</strong>
          {atFx} ({t("CBOT only, excl. premium", "só CBOT, sem prêmio")}).
        </>
      ) : (
        <>
          CBOT <strong className="text-ink-2">{f.money(last, "c_bu")}</strong> + {t("your premium", "seu prêmio")}{" "}
          <strong className="text-ink-2">{f.signed0(premium)}¢/bu</strong>
          {local && (
            <>
              {" "}
              − {t("your discount", "seu desconto")} <strong className="text-ink-2">R$ {f.num(basis, 2)}/sc</strong>
            </>
          )}{" "}
          = {fobWord} <strong className="text-ink-2">{f.money(convert(last, unit, a), unit)}</strong>
          {atFx}.
        </>
      )}
    </p>
  );
}

/** P15: how far the live forecast is from the release-day origins the ranges were tested on. */
export function useIssuedLabel(meta: Meta): string {
  const { loc } = useI18n();
  return issuedLabel(meta.days_since_report, meta.latest_wasde.month, loc);
}
