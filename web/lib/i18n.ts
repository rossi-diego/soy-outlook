// Client-side localisation (P20): one static site, two locales, chosen in the browser.
//
// - English is the default (the EU recruiter audience; also what the static HTML is rendered in).
// - The first visit follows navigator.language ("pt*" -> pt-BR); an explicit choice from the header
//   toggle is persisted in localStorage (wrapped in try/catch: private windows can throw).
// - <html lang> is set before paint by `localeBootScript` and kept in sync on every change.
// - Numbers and caveats are identical across locales: only words and number/date formatting change
//   (lib/format.ts, Intl). The e2e suite checks the numbers on every page match in both locales.

export type Locale = "en" | "pt-BR";
export const LOCALES: Locale[] = ["en", "pt-BR"];

const KEY = "soy-locale";
const EVENT = "soy-locale-change";

const isLocale = (v: unknown): v is Locale => v === "en" || v === "pt-BR";

/** Stored choice first, then the browser language; anything that is not Portuguese stays English. */
export function initialLocale(stored: string | null, navigatorLanguage: string | undefined): Locale {
  if (isLocale(stored)) return stored;
  return (navigatorLanguage ?? "").toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

/** Inlined in <head>: sets <html lang> before paint, with the same rule as initialLocale. */
export const localeBootScript = `try{var s=null;try{s=localStorage.getItem("${KEY}")}catch(e){}var l=s==="pt-BR"||s==="en"?s:((navigator.language||"").toLowerCase().indexOf("pt")===0?"pt-BR":"en");document.documentElement.lang=l}catch(e){}`;

/** The stored or browser locale (client only). */
export function readLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null; // storage unavailable: fall back to the browser language
  }
  return initialLocale(stored, typeof navigator === "undefined" ? undefined : navigator.language);
}

// When storage throws, the in-memory choice wins for the rest of the page view.
let memo: Locale | null = null;

export const currentLocale = (): Locale => memo ?? readLocale();

export const LOCALE_EVENT = EVENT;

export function setLocale(l: Locale) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* not persisted; the choice still applies to this page view */
    memo = l;
  }
  document.documentElement.lang = l;
  window.dispatchEvent(new Event(EVENT));
}


// ---------------------------------------------------------------------------------------------
// Words that come from the published JSON (written in English by the Python pipeline). Looked up
// by id where there is one, by exact text otherwise; anything unknown is shown as published.

const PT_DATA: Record<string, string> = {
  // models (meta.models)
  "No change (random walk)": "Sem variação (passeio aleatório)",
  "Average past change": "Variação média passada",
  "ARIMA(0,1,1) on price": "ARIMA(0,1,1) no preço",
  "WASDE ridge regression": "Regressão ridge com o WASDE",
  // features and WASDE lines
  "US soybean stocks-to-use": "Relação estoque/uso da soja nos EUA",
  "US corn stocks-to-use": "Relação estoque/uso do milho nos EUA",
  "Brazil soybean crop": "Safra de soja do Brasil",
  "Argentina soybean crop": "Safra de soja da Argentina",
  "China soybean imports": "Importações de soja da China",
  "World soybean ending stocks": "Estoques finais mundiais de soja",
  "CBOT soybeans, change over the past month": "Soja na CBOT, variação no último mês",
  "CBOT soybeans, change over the past 3 months": "Soja na CBOT, variação nos últimos 3 meses",
  "May report (new marketing year starts)": "Relatório de maio (começa o novo ano-safra)",
  // premium and stress copy
  "historical median, not validated": "mediana histórica, não validada",
  "illustrative scenarios, not probabilities": "cenários ilustrativos, não probabilidades",
  "Five episodes named before any outcome was computed; each starts at the first CBOT session of its month; the realized h-month return is applied to today's price.":
    "Cinco episódios nomeados antes de qualquer resultado ser calculado; cada um começa no primeiro pregão da CBOT do seu mês; o retorno realizado em h meses é aplicado ao preço de hoje.",
  "CBOT only: no port premium is added; R$ per sack converts the CBOT price at today's PTAX, held fixed":
    "Só CBOT: nenhum prêmio de porto é somado; R$ por saca converte o preço CBOT pela PTAX de hoje, mantida fixa",
  "Trade war": "Guerra comercial",
  "China buying": "Compras da China",
  "May 2021 correction": "Correção de maio de 2021",
  "Ukraine invasion": "Invasão da Ucrânia",
  "2024 sell-off": "Queda de 2024",
  "China's retaliatory tariff on US soybeans, announced mid-June 2018.":
    "Tarifa retaliatória da China sobre a soja dos EUA, anunciada em meados de junho de 2018.",
  "Record Chinese purchases of US new crop from the summer of 2020.":
    "Compras recordes da China de safra nova dos EUA a partir do verão (no hemisfério norte) de 2020.",
  "The May 2021 peak and the fall that followed.": "O pico de maio de 2021 e a queda que veio depois.",
  "Russia's invasion of Ukraine on 24 February 2022.": "A invasão da Ucrânia pela Rússia em 24 de fevereiro de 2022.",
  "The July 2024 slide on a large US crop outlook.": "A queda de julho de 2024 com a perspectiva de uma grande safra nos EUA.",
  // range methods and inference rule
  "empirical quantiles of past errors": "quantis empíricos dos erros passados",
  "EWMA filtered historical simulation (lambda 0.94)": "simulação histórica filtrada por EWMA (lambda 0,94)",
  "plain volatility band (lognormal, 63-session realized vol)":
    "banda simples de volatilidade (lognormal, vol realizada de 63 pregões)",
  "squared log-return error": "erro quadrático do log-retorno",
  "absolute error, USD/t": "erro absoluto, USD/t",
  "Pre-registered 2026-11-08: baseline, one EWMA(0.94) FHS challenger and a naive lognormal vol band, chosen on validation only by the same interval-score ratio; only the winner is published, the holdout is reported.":
    "Pré-registrado em 08/11/2026: a referência, um desafiante FHS com EWMA(0,94) e uma banda lognormal simples de volatilidade, escolhidos só na validação pela mesma razão de interval score; só o vencedor é publicado, o holdout é apenas relatado.",
  "HAC SE (Bartlett, lag h-1); moving-block bootstrap 95% CI (block h, 2000 draws); n_eff = n p(1-p) / long-run variance; Kupiec and Christoffersen on the h non-overlapping subsamples (median p); MDE at 5% one-sided, 80% power, MAE units":
    "Erro-padrão HAC (Bartlett, defasagem h-1); IC de 95% por bootstrap de blocos móveis (bloco h, 2000 sorteios); n_eff = n p(1-p) / variância de longo prazo; Kupiec e Christoffersen nas h subamostras sem sobreposição (p mediano); MDE a 5% unilateral, poder de 80%, em unidades de MAE",
};

/** A JSON-published English string in the active locale (unknown strings pass through). */
export function dataText(loc: Locale, s: string): string {
  if (loc !== "pt-BR") return s;
  if (PT_DATA[s]) return PT_DATA[s];
  if (s.startsWith("Revision: ")) {
    const rest = s.slice("Revision: ".length);
    return `Revisão: ${PT_DATA[rest] ?? rest}`;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Chrome shared by every page.

export const NAV: { href: string; en: string; pt: string }[] = [
  { href: "/", en: "Outlook", pt: "Perspectiva" },
  { href: "/wasde/", en: "This WASDE", pt: "Este WASDE" },
  { href: "/track-record/", en: "Track record", pt: "Histórico" },
  { href: "/methodology/", en: "Methodology", pt: "Metodologia" },
];

/** One-line definitions of the statistical terms, shown on hover and focus. */
export const TERMS: Record<
  "dm" | "cw" | "holm" | "p" | "hit" | "mde" | "kupiec" | "christ",
  { en: string; pt: string }
> = {
  dm: {
    en: "Diebold-Mariano test: is the difference in average forecast error between two models larger than chance? Small p = a real difference.",
    pt: "Teste de Diebold-Mariano: a diferença de erro médio entre dois modelos é maior do que o acaso explicaria? p pequeno = diferença real.",
  },
  cw: {
    en: "Clark-West test: the right test when the challenger nests 'no change' (it adds terms to it). One-sided: small p = the challenger is better.",
    pt: "Teste de Clark-West: o teste certo quando o desafiante contém o 'sem variação' (acrescenta termos a ele). Unilateral: p pequeno = o desafiante é melhor.",
  },
  holm: {
    en: "Holm adjustment: makes p-values stricter when many tests are run together, so one lucky result among nine does not count as a finding.",
    pt: "Ajuste de Holm: deixa os p-valores mais exigentes quando muitos testes são feitos juntos, para que um resultado de sorte entre nove não conte como descoberta.",
  },
  p: {
    en: "p-value: how often a difference this large would appear by chance if there were no real difference. Below 0.05 is the usual bar.",
    pt: "p-valor: com que frequência uma diferença desse tamanho apareceria por acaso se não houvesse diferença real. Abaixo de 0,05 é a régua usual.",
  },
  hit: {
    en: "Hit rate: the share of past outcomes that landed inside the range. A well-calibrated 80% range holds about 80% of the time.",
    pt: "Taxa de acerto: a parcela dos resultados passados que caiu dentro da faixa. Uma faixa de 80% bem calibrada acerta cerca de 80% das vezes.",
  },
  mde: {
    en: "Minimum detectable effect: the smallest error reduction the test would catch most of the time with this many reports.",
    pt: "Efeito mínimo detectável: a menor redução de erro que o teste captaria na maioria das vezes com esse número de relatórios.",
  },
  kupiec: {
    en: "Kupiec test: is the share of misses consistent with the nominal level? Small p = the range is mis-sized.",
    pt: "Teste de Kupiec: a parcela de erros fora da faixa é compatível com o nível nominal? p pequeno = faixa mal dimensionada.",
  },
  christ: {
    en: "Christoffersen test: do misses cluster in time instead of arriving independently? Small p = clustering.",
    pt: "Teste de Christoffersen: os erros fora da faixa se agrupam no tempo em vez de chegarem de forma independente? p pequeno = agrupamento.",
  },
};
