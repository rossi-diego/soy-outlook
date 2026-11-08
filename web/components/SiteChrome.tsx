"use client";

import Link from "next/link";

import { type Locale, NAV, setLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/useI18n";
import { AUTHOR, REPO_URL } from "@/lib/site";

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
    >
      {t("Skip to content", "Pular para o conteúdo")}
    </a>
  );
}

export function MainNav() {
  const { t } = useI18n();
  return (
    <nav
      className="-mx-4 order-last flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0"
      aria-label={t("Main", "Principal")}
    >
      {NAV.map((n) => (
        <Link key={n.href} className="rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink" href={n.href}>
          {t(n.en, n.pt)}
        </Link>
      ))}
    </nav>
  );
}

export function AsOf({ asOf, nextWasde }: { asOf: string; nextWasde: string | null }) {
  const { t, f } = useI18n();
  // The as-of date stays visible on every width; the next-WASDE date joins it from sm up.
  return (
    <span data-testid="as-of">
      <span className="hidden sm:inline">{t("CBOT close ", "Fechamento CBOT ")}</span>
      <span className="sm:hidden">{t("Close ", "Fech. ")}</span>
      <strong className="text-ink">{f.date(asOf)}</strong>
      {nextWasde && (
        <span className="hidden sm:inline">
          {" "}
          · {t("next WASDE", "próximo WASDE")} {f.date(nextWasde)}
        </span>
      )}
    </span>
  );
}

const LOCALE_OPTIONS: { id: Locale; label: string; name: string }[] = [
  { id: "en", label: "EN", name: "English" },
  { id: "pt-BR", label: "PT", name: "Português (Brasil)" },
];

/** Language switch (P20): two toggle buttons with aria-pressed, persisted by setLocale. */
export function LocaleToggle() {
  const { loc, t } = useI18n();
  return (
    <div role="group" aria-label={t("Language", "Idioma")} className="inline-flex h-8 items-center rounded-full border border-line p-0.5 text-xs">
      {LOCALE_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          lang={o.id}
          aria-pressed={loc === o.id}
          aria-label={o.name}
          title={o.name}
          onClick={() => setLocale(o.id)}
          className={`h-full rounded-full px-2 ${loc === o.id ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SiteFooter({
  wasdeMonth,
  generatedAt,
}: {
  wasdeMonth: string;
  generatedAt: string;
}) {
  const { t, f } = useI18n();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-y-2 px-4 py-6 text-xs text-muted">
      <p className="text-sm text-ink-2">
        {t("Built by", "Feito por")} <strong className="text-ink">{AUTHOR.name}</strong> ·{" "}
        <a className="underline hover:text-ink" href={AUTHOR.linkedin}>
          LinkedIn
        </a>{" "}
        ·{" "}
        <a className="underline hover:text-ink" href={AUTHOR.github}>
          GitHub
        </a>{" "}
        ·{" "}
        <Link className="underline hover:text-ink" href="/methodology/#about">
          {t("About", "Sobre")}
        </Link>
      </p>
      <p>
        {t("Sources: USDA WASDE (", "Fontes: USDA WASDE (")}
        {f.month(wasdeMonth)}, {t("via", "via")}{" "}
        <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app">
          WASDE Tracker
        </a>
        {t(
          "), CBOT soybean futures (Yahoo Finance, delayed, front month) and BCB PTAX. No premium data: the Paranaguá premium is your input.",
          "), futuros de soja da CBOT (Yahoo Finance, com atraso, primeiro vencimento) e PTAX do BCB. Sem dados de prêmio: o prêmio de Paranaguá é informado por você.",
        )}
      </p>
      <p>
        {t(
          "Research and educational use only; not investment, trading or hedging advice. Ranges describe past forecast errors, not a guarantee; FOB values appear only once you enter your own premium quote.",
          "Uso apenas para pesquisa e educação; não é recomendação de investimento, de operação ou de hedge. As faixas descrevem erros de previsão passados, não uma garantia; os valores FOB só aparecem depois que você informa a sua cotação de prêmio.",
        )}
      </p>
      <p>
        {t("Generated", "Gerado em")} {generatedAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
        <a className="underline hover:text-ink" href="/data/backtest.csv">
          backtest.csv
        </a>{" "}
        ·{" "}
        <a className="underline hover:text-ink" href="/data/outlook.json">
          outlook.json
        </a>{" "}
        ·{" "}
        <a className="underline hover:text-ink" href={REPO_URL}>
          {t("Source code", "Código-fonte")}
        </a>
      </p>
    </div>
  );
}
