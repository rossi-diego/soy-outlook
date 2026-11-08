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
  // stress copy
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
  { href: "/", en: "Outlook", pt: "Panorama" },
  { href: "/wasde/", en: "Report day", pt: "Dia do relatório" },
  { href: "/track-record/", en: "Track record", pt: "Histórico" },
  { href: "/methodology/", en: "Method", pt: "Método" },
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

// ---------------------------------------------------------------------------------------------
// The home page story (Outlook). Every number is passed in from the published data; the copy
// only words it. STORY_PT is typed as STORY_EN, so a key added to one language must be added to
// the other. The Portuguese is written for a Brazilian trading desk, not translated word for word.

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "na terça-feira", "no sábado": the article follows the weekday's gender.
const WEEKDAYS_PT = ["no domingo", "na segunda-feira", "na terça-feira", "na quarta-feira", "na quinta-feira", "na sexta-feira", "no sábado"];

type Side = "up" | "down" | null;

const STORY_EN = {
  eyebrow: "Brazilian soybean price outlook",
  h1Lead: "How far could soybeans move",
  h1Accent: (month: string) => `by ${month}?`,
  lede: (nInTen: number, since: string) =>
    `Nobody can reliably call the direction, and we tested that. So we show how far the price is likely to travel, using ranges that held about ${nInTen} times in 10 in tests since ${since}.`,
  settings: "Settings",
  settingsState: (unit: string, fob: boolean) => `${unit}, ${fob ? "with your premium" : "CBOT only"}`,
  ticketLabel: (fob: boolean): string => (fob ? "Paranaguá FOB, your premium" : "CBOT soybeans"),
  ticketClose: (date: string) => `${date} close`,
  perUnit: { usd_t: "per tonne", brl_sack: "per 60 kg sack", c_bu: "per bushel" } as Record<string, string>,
  months12: "12 months",
  nextReport: "Next USDA report",
  noDate: "see USDA calendar",
  inH: (h: string) => `In ${h}`,
  to: "to",
  heldFlag: (held: number, nominal: number) => `⚠ held ${held} in 10, not ${nominal}`,
  ladderLabel: (unit: string) => `Likely price ranges in 1, 3 and 6 months on one shared scale, ${unit}`,
  ladderNote: (nInTen: number) =>
    `Bars show the 80% range (built to hold ${nInTen} times in 10) on one shared scale; the vertical line is today's price.`,

  ch1Eyebrow: "1 · The problem",
  ch1Title: "Soybean prices swing hard, and fast.",
  ch1Body: (since: string, lo: string, hi: string, minMove: number, maxMove: number) =>
    `Since ${since} the CBOT price has ranged from ${lo} to ${hi} per tonne. Each episode marked below moved it by ${minMove} to ${maxMove} percent within three months. If you sell or buy soybeans, that is your budget moving.`,
  ch1Chart: (since: string) => `CBOT soybean price per tonne since ${since}, with past stress episodes marked`,
  ch1Move: (pct: string, months: number) => `${pct} in ${months} months`,
  ch1Cap: (from: string, to: string) =>
    `CBOT front-month soybeans in US$ per tonne (CBOT only, no premium), weekly closes from ${from} to ${to}. Marked: the episodes named in advance for the stress test, with the price move over the three months that followed.`,

  ch2Eyebrow: "2 · We tried to predict it",
  ch2Title: (n: number) => `${n} models, one honest result.`,
  ch2Body: (n: number) =>
    `We put the forecasters in a contest, including a machine-learning model that reads every USDA WASDE report. Each one only saw what was public on the day it made its forecast. Then we scored them against what the price actually did three months later, ${n} times.`,
  model: {
    rw: ["No change", "the price stays where it is"],
    arima: ["ARIMA", "a classic time-series model"],
    drift: ["Average past change", "the recent trend continues"],
    ridge: ["Machine learning on WASDE", "ridge regression on USDA supply data"],
  } as Record<string, [string, string]>,
  lowest: "lowest",
  typicalMiss: "Typical miss",
  pull:
    "None of them beat the simplest guess, “the price stays where it is”. That is not a failure. It is what an efficient market looks like, and most forecasts you read online would not survive this test.",
  pullNoWin: "The simplest guess, “the price stays where it is”, kept up with every challenger. Track record has the full tests.",
  ch2Cap: (unit: string, years: string, holm: boolean) =>
    `Typical miss = mean absolute error of the 3-month forecast, ${unit}, validation period ${years}. ${
      holm
        ? "No challenger beat “no change” once the tests were adjusted for running several at once (Holm)."
        : "Some differences pass the Holm-adjusted test."
    } Full results on Track record.`,

  ch3Eyebrow: "3 · So we changed the question",
  ch3Title: "Not “where will it go?” but “how far could it go?”",
  ch3Body: (n: number) =>
    `Every past forecast left a miss behind. We collected those misses and turned them into a range. Then we checked the range the hard way: ${n} times, we drew it before knowing the outcome.`,
  of: "of",
  statHeld: (years: string) => `3-month ranges held the actual price, ${years}`,
  statRate: (nominal: string) => `hit rate, against the ${nominal} promised`,
  statHoldout: (years: string, held: number, n: number) => `in ${years}, kept aside as a final exam (${held} of ${n})`,
  ch3Chart: (n: number) => `${n} past 3-month ranges against the actual price, CBOT US$ per tonne`,
  ch3Exam: (years: string) => `final exam, ${years}`,
  ch3CapIn: "price ended inside the range",
  ch3CapOut: "price ended outside",
  ch3Cap: (years: string) =>
    `Each bar is a 3-month 80% range drawn before its date, in CBOT US$ per tonne. The shaded area is the ${years} final exam, never used to tune anything.`,

  ch4Eyebrow: "4 · Today's outlook",
  ch4Title: (price: string) => `From ${price} today, here is the road ahead.`,
  ch4Body: (n80: number, n95: number) =>
    `The further out you look, the wider the road. The thick bar is the range built to hold ${n80} times in 10; the thin line, ${n95} times in 20.`,
  ch4Chart: (unit: string) => `Recent price and the 1, 3 and 6-month ranges, ${unit}`,
  ch4NoChange: "no change",
  ch4Warn: (h: number, held: string, years: string, nominal: string, side: Side) =>
    `The ${h}-month range held ${held} of the time in ${years} rather than ${nominal}, so treat it as a little too narrow${
      side === "up" ? ", mostly on the upside" : side === "down" ? ", mostly on the downside" : ""
    }.`,
  ch4Unit: (unitLong: string) => `${unitLong}. The dashed line is “no change”, the central forecast.`,
  ch4Table: "The ranges by horizon",

  ch5Eyebrow: "5 · What it means for you",
  ch5Title: "Turn the range into money.",
  ch5Body: (oneIn: number) =>
    `Tell us your position. We show what a bad outcome (1 in ${oneIn}) would cost compared with locking in today's price.`,
  iAm: "I am a",
  seller: "Seller",
  buyer: "Buyer",
  volume: "Volume, tonnes",
  hedged: "Already hedged",
  badCase: (oneIn: number, price: string) => `In a bad case (1 in ${oneIn}), compared with locking in ${price} today:`,
  hintHalf: "Hedging half your volume would cut the 3-month bad case to about",
  hintAt: (pct: number) => `With ${pct}% hedged, the 3-month bad case is`,
  tryHalf: "Try 50% hedged",
  tailUp: (pct: string) => `Prices rose above this range in ${pct} of tested reports: the bad case is likely understated.`,
  tailDown: (pct: string) => `Prices fell below this range in ${pct} of tested reports: the bad case is likely understated.`,
  ch5Cap:
    "Bad case = the edge of the 80% range on your side. CBOT only: premium, freight, basis, margin calls and contract rolls are left out. An illustration, not advice.",
  ch5More: "The full panel (rough 1 in 40, sacks, target price, tail checks) is on Track record, under “For analysts”.",

  ch6Eyebrow: "6 · Your next decision point",
  ch6Title: (weekday: number) => `USDA's WASDE report lands on ${WEEKDAYS_EN[weekday]}.`,
  ch6TitleNone: "The next USDA WASDE report",
  ch6Body: (typ: string, tail: string) =>
    `On report day the price usually moves about ±${typ}. One report in ten moves it more than ±${tail}. If a decision depends on the price, that is the day to watch.`,
  ch6Link: "See what the last report changed",
  ch6Chart: (typ: string, tail: string, price: string) =>
    `Typical report-day move of ±${typ} and a 1-in-10 move of ±${tail} around today's ${price}`,
  ch6Legend: ["inner band: a typical report day", "outer band: 9 reports in 10"] as [string, string],
  today: "today",
  analysts: "For analysts",
};

const STORY_PT: typeof STORY_EN = {
  eyebrow: "Panorama de preço da soja brasileira",
  h1Lead: "Quanto o preço da soja pode andar",
  h1Accent: (month: string) => `até ${month}?`,
  lede: (nInTen: number, since: string) =>
    `Ninguém acerta a direção do preço com consistência, e nós testamos isso. Por isso mostramos até onde o preço deve andar, com faixas que acertaram cerca de ${nInTen} em cada 10 vezes nos testes desde ${since}.`,
  settings: "Ajustes",
  settingsState: (unit: string, fob: boolean) => `${unit}, ${fob ? "com o seu prêmio" : "só CBOT"}`,
  ticketLabel: (fob: boolean) => (fob ? "FOB Paranaguá, com o seu prêmio" : "Soja na CBOT"),
  ticketClose: (date: string) => `fechamento de ${date}`,
  perUnit: { usd_t: "por tonelada", brl_sack: "por saca de 60 kg", c_bu: "por bushel" },
  months12: "12 meses",
  nextReport: "Próximo relatório do USDA",
  noDate: "veja o calendário do USDA",
  inH: (h: string) => `Em ${h}`,
  to: "a",
  heldFlag: (held: number, nominal: number) => `⚠ acertou ${held} em 10, não ${nominal}`,
  ladderLabel: (unit: string) => `Faixas prováveis de preço em 1, 3 e 6 meses numa escala comum, ${unit}`,
  ladderNote: (nInTen: number) =>
    `As barras mostram a faixa de 80% (feita para acertar ${nInTen} em cada 10 vezes) numa escala comum; a linha vertical é o preço de hoje.`,

  ch1Eyebrow: "1 · O problema",
  ch1Title: "O preço da soja oscila forte, e rápido.",
  ch1Body: (since: string, lo: string, hi: string, minMove: number, maxMove: number) =>
    `Desde ${since}, o preço na CBOT andou entre ${lo} e ${hi} por tonelada. Cada episódio marcado abaixo moveu o preço entre ${minMove}% e ${maxMove}% em três meses. Para quem vende ou compra soja, é o orçamento que se mexe junto.`,
  ch1Chart: (since: string) => `Preço da soja na CBOT por tonelada desde ${since}, com os episódios de estresse marcados`,
  ch1Move: (pct: string, months: number) => `${pct} em ${months} meses`,
  ch1Cap: (from: string, to: string) =>
    `Soja na CBOT, primeiro vencimento, em US$ por tonelada (só CBOT, sem prêmio), fechamentos semanais de ${from} a ${to}. Marcados: os episódios definidos de antemão para o teste de estresse, com o movimento do preço nos três meses seguintes.`,

  ch2Eyebrow: "2 · Tentamos prever",
  ch2Title: (n: number) => `${n} modelos, um resultado honesto.`,
  ch2Body: (n: number) =>
    `Colocamos os modelos para competir, inclusive um de machine learning que lê cada relatório WASDE do USDA. Cada um só via o que era público no dia da previsão. Depois comparamos cada previsão com o que o preço de fato fez três meses depois, ${n} vezes.`,
  model: {
    rw: ["Sem variação", "o preço fica onde está"],
    arima: ["ARIMA", "um modelo clássico de séries temporais"],
    drift: ["Variação média passada", "a tendência recente continua"],
    ridge: ["Machine learning com o WASDE", "regressão ridge com dados de oferta do USDA"],
  },
  lowest: "menor",
  typicalMiss: "Erro típico",
  pull:
    "Nenhum deles superou o palpite mais simples, “o preço fica onde está”. Isso não é um fracasso. É assim que um mercado eficiente se comporta, e a maioria das previsões que circulam por aí não passaria neste teste.",
  pullNoWin: "O palpite mais simples, “o preço fica onde está”, acompanhou todos os desafiantes. Os testes completos estão no Histórico.",
  ch2Cap: (unit: string, years: string, holm: boolean) =>
    `Erro típico = erro absoluto médio da previsão de 3 meses, ${unit}, período de validação ${years}. ${
      holm
        ? "Nenhum desafiante superou o “sem variação” depois de ajustar os testes por terem sido feitos vários de uma vez (Holm)."
        : "Algumas diferenças passam no teste com ajuste de Holm."
    } Resultados completos no Histórico.`,

  ch3Eyebrow: "3 · Então mudamos a pergunta",
  ch3Title: "Não “para onde vai?”, mas “até onde pode ir?”",
  ch3Body: (n: number) =>
    `Cada previsão passada deixou um erro para trás. Juntamos esses erros e os transformamos em uma faixa. Depois testamos a faixa do jeito difícil: ${n} vezes, ela foi traçada antes de se saber o resultado.`,
  of: "de",
  statHeld: (years: string) => `faixas de 3 meses contiveram o preço real, ${years}`,
  statRate: (nominal: string) => `de acerto, contra os ${nominal} prometidos`,
  statHoldout: (years: string, held: number, n: number) => `em ${years}, separado como prova final (${held} de ${n})`,
  ch3Chart: (n: number) => `${n} faixas de 3 meses passadas contra o preço real, CBOT em US$ por tonelada`,
  ch3Exam: (years: string) => `prova final, ${years}`,
  ch3CapIn: "preço terminou dentro da faixa",
  ch3CapOut: "preço terminou fora",
  ch3Cap: (years: string) =>
    `Cada barra é uma faixa de 80% para 3 meses, traçada antes da data, em US$ por tonelada na CBOT. A área sombreada é a prova final de ${years}, nunca usada para ajustar nada.`,

  ch4Eyebrow: "4 · O panorama de hoje",
  ch4Title: (price: string) => `Partindo de ${price} hoje, este é o caminho à frente.`,
  ch4Body: (n80: number, n95: number) =>
    `Quanto mais longe, mais largo o caminho. A barra grossa é a faixa feita para acertar ${n80} em cada 10 vezes; a linha fina, ${n95} em cada 20.`,
  ch4Chart: (unit: string) => `Preço recente e as faixas de 1, 3 e 6 meses, ${unit}`,
  ch4NoChange: "sem variação",
  ch4Warn: (h: number, held: string, years: string, nominal: string, side: Side) =>
    `A faixa de ${h === 1 ? "1 mês" : `${h} meses`} acertou ${held} das vezes em ${years}, e não ${nominal}; trate-a como um pouco estreita demais${
      side === "up" ? ", sobretudo para cima" : side === "down" ? ", sobretudo para baixo" : ""
    }.`,
  ch4Unit: (unitLong: string) => `${unitLong}. A linha tracejada é o “sem variação”, a previsão central.`,
  ch4Table: "As faixas por horizonte",

  ch5Eyebrow: "5 · O que isso significa para você",
  ch5Title: "Transforme a faixa em dinheiro.",
  ch5Body: (oneIn: number) =>
    `Conte qual é a sua posição. Mostramos quanto um cenário ruim (1 em ${oneIn}) custaria em comparação com travar o preço de hoje.`,
  iAm: "Eu sou",
  seller: "Vendedor",
  buyer: "Comprador",
  volume: "Volume, toneladas",
  hedged: "Já com hedge",
  badCase: (oneIn: number, price: string) => `Num cenário ruim (1 em ${oneIn}), em comparação com travar ${price} hoje:`,
  hintHalf: "Fazer hedge de metade do volume reduziria o cenário ruim de 3 meses para cerca de",
  hintAt: (pct: number) => `Com ${pct}% de hedge, o cenário ruim de 3 meses é`,
  tryHalf: "Testar 50% de hedge",
  tailUp: (pct: string) => `O preço subiu acima desta faixa em ${pct} dos relatórios testados: o cenário ruim provavelmente está subestimado.`,
  tailDown: (pct: string) => `O preço caiu abaixo desta faixa em ${pct} dos relatórios testados: o cenário ruim provavelmente está subestimado.`,
  ch5Cap:
    "Cenário ruim = a ponta da faixa de 80% do seu lado. Só CBOT: prêmio, frete, base, chamadas de margem e rolagens de contrato ficam de fora. É uma ilustração, não uma recomendação.",
  ch5More: "O painel completo (1 em 40 aproximado, sacas, preço-alvo, alertas de cauda) está no Histórico, em “Para analistas”.",

  ch6Eyebrow: "6 · Seu próximo ponto de decisão",
  ch6Title: (weekday: number) => `O relatório WASDE do USDA sai ${WEEKDAYS_PT[weekday]}.`,
  ch6TitleNone: "O próximo relatório WASDE do USDA",
  ch6Body: (typ: string, tail: string) =>
    `No dia do relatório o preço costuma se mover cerca de ±${typ}. Um relatório em cada dez move mais de ±${tail}. Se uma decisão depende do preço, esse é o dia de ficar de olho.`,
  ch6Link: "Veja o que o último relatório mudou",
  ch6Chart: (typ: string, tail: string, price: string) =>
    `Movimento típico no dia do relatório de ±${typ} e movimento de 1 em 10 de ±${tail} em torno dos ${price} de hoje`,
  ch6Legend: ["faixa interna: um dia de relatório típico", "faixa externa: 9 relatórios em 10"],
  today: "hoje",
  analysts: "Para analistas",
};

export type StoryCopy = typeof STORY_EN;

/** The home page copy in one locale. */
export const storyCopy = (loc: Locale): StoryCopy => (loc === "pt-BR" ? STORY_PT : STORY_EN);
