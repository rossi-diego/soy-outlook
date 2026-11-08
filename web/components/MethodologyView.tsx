"use client";

import type { Meta } from "@/lib/types";
import { AUTHOR, REPO_URL } from "@/lib/site";
import { useI18n } from "@/lib/useI18n";

function Block({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 space-y-3 p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline hover:text-ink" href={href}>
    {children}
  </a>
);

const LICENSES = "https://github.com/rossi-diego/sarimax-brazilian-soybean-forecasting/blob/main/DATA_LICENSES.md";

/** The /methodology/ page body in both locales (P20); every number comes from meta.json. */
export default function MethodologyView({ meta }: { meta: Meta }) {
  const { pt, f, d } = useI18n();
  const champions = Object.entries(meta.champion)
    .map(([h, m]) => `${h}m ${m === "rw" ? (pt ? "sem variação" : "no change") : d(meta.models[m])}`)
    .join(", ");
  const features = meta.features.map((x) => d(x.label).toLowerCase()).join("; ");
  const indep6 = Math.round(meta.calibration_window / 6);
  const sameMethod = meta.intervals.range_method === meta.intervals.range_baseline;
  const links = (
    <p>
      <A href={AUTHOR.linkedin}>LinkedIn</A> · <A href={AUTHOR.github}>GitHub</A> · <A href={REPO_URL}>{pt ? "Código-fonte" : "Source code"}</A>
    </p>
  );

  if (pt)
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Metodologia</h1>
        <p className="text-ink-2">
          Linguagem simples primeiro; o detalhe técnico vem em cada seção. Os dados de CBOT, WASDE e câmbio são públicos e
          reconstruídos pelo pipeline de código aberto a cada execução. O prêmio de Paranaguá não tem fonte licenciada, então
          nenhum dado de prêmio é distribuído: ele é só um número que você informa (veja Dados e licenças abaixo).
        </p>

        <Block title="O que é previsto">
          <p>
            O preço FOB Paranaguá é o preço da soja na CBOT mais o prêmio de Paranaguá. A parte CBOT é pública e prevista aqui.
            O prêmio não tem fonte gratuita e licenciada, então ele é <strong className="text-ink">informado por você</strong>,
            sem valor padrão: até você digitar a cotação do seu corretor, a página mostra a CBOT em ¢/bu, em USD/t e em R$/saca
            pela PTAX (só CBOT, sem prêmio); o FOB aparece só depois que você informa um prêmio, mantido constante em todos os
            horizontes.
          </p>
          <p>
            Tecnicamente: para cada divulgação do WASDE desde julho de 2010, o alvo é a variação logarítmica do fechamento do
            primeiro vencimento da CBOT, do dia da divulgação até o último pregão em ou antes de 1, 3 e 6 meses-calendário
            depois. O fechamento do dia da divulgação faz parte do conjunto de informação (o USDA publica às 12:00 ET, a CBOT
            fecha às 13:20 CT).
          </p>
        </Block>

        <Block title="Só o que se sabia naquele dia">
          <p>
            Cada valor do WASDE é o publicado naquele relatório, nunca uma revisão posterior. Eles vêm do histórico do{" "}
            <A href="https://wasde-tracker.vercel.app">WASDE Tracker</A> ({meta.wasde_source.reports} relatórios, release{" "}
            {meta.wasde_source.tag ?? "local"}, arquivo fixado por sha256). O ano-safra projetado é o mais recente de cada
            relatório; ele avança em maio, então as revisões só são calculadas dentro do mesmo ano-safra e uma dummy de maio
            marca a virada.
          </p>
          <p>
            Regra de expurgo: quando uma previsão é feita no dia t, qualquer linha passada usada para ajustar um modelo,
            escolher uma penalidade ou definir uma faixa precisa ter o resultado datado em ou antes de t. As datas dos
            relatórios são irregulares, então a regra é aplicada sobre datas, não sobre contagem de linhas. Testes unitários
            garantem isso.
          </p>
        </Block>

        <Block title="Modelos, do mais simples para cima">
          <ol className="list-decimal space-y-1 pl-5">
            {Object.entries(meta.models).map(([id, label]) => (
              <li key={id}>{d(label)}</li>
            ))}
          </ol>
          <p>
            O modelo WASDE usa um conjunto de variáveis fixado de antemão (sem seleção guiada pelos dados): {features}. As
            variáveis são padronizadas dentro de cada janela de treino; a penalidade do ridge é escolhida numa divisão interna
            expurgada. O ARIMA(0,1,1) sem drift prevê o mesmo nível em todos os horizontes, então as suas previsões de 3 e 6
            meses são iguais à de 1 passo.
          </p>
          <p>
            Um modelo só substitui o &ldquo;sem variação&rdquo; num horizonte se o superar no período de validação num teste de
            Clark-West (o teste certo quando um modelo contém o outro), com ajuste de Holm sobre os nove testes modelo ×
            horizonte a p &lt; {f.num(meta.champion_alpha, 2)}, e só se o seu {d(meta.inference_rule.primary_loss)} também for
            menor. Testes de Diebold-Mariano com a correção de Harvey-Leybourne-Newbold e variância de Newey-West são
            relatados junto, na mesma perda principal e, como verificação secundária, no {d(meta.inference_rule.secondary_loss)}.
            Vencedores atuais: {champions}.
          </p>
          <p>
            Esta é a regra de inferência v{meta.inference_rule.version}, fixada em {f.date(meta.inference_rule.registered)}. A
            primeira versão misturava perdas: Diebold-Mariano sobre erros absolutos em USD/t, Clark-West sobre erros
            quadráticos do log-retorno e um desempate pelo erro absoluto médio. Um modelo podia passar num teste e falhar em
            outro só por causa das unidades. A versão 2 usa uma única perda principal, mantém o erro absoluto como
            secundário, ajusta para os nove testes de uma vez e testa a direção com um teste de Pesaran-Timmermann com erros
            robustos à sobreposição (HAC) em vez de um teste binomial que ignora janelas sobrepostas. Nenhuma conclusão mudou:
            nenhum modelo supera o sem variação em nenhuma das duas regras.
          </p>
        </Block>

        <Block title="Faixas">
          <p>
            As faixas de 80% e 95% são {d(meta.intervals.method)}: quantis dos últimos {meta.calibration_window} erros realizados
            fora da amostra do modelo vencedor naquele horizonte
            {meta.intervals.centring === "median" ? ", centrados na sua mediana para que a banda não carregue uma tendência passada" : ""}
            . Isto não é conformal split: as janelas de 3 e 6 meses se sobrepõem, então os erros não são intercambiáveis e
            nenhuma garantia de amostra finita é reivindicada. A centragem foi escolhida entre {meta.intervals.candidates.join(" e ")}{" "}
            por uma regra fixada de antemão (interval score só no período de validação).
          </p>
          <p>
            Duas alternativas escaladas pela volatilidade foram fixadas de antemão e avaliadas da mesma forma:{" "}
            {d(meta.intervals.range_labels.ewma_fhs)} e uma {d(meta.intervals.range_labels.lognormal_rv)}. Só o vencedor na
            validação é publicado:{" "}
            {sameMethod
              ? "nenhuma superou os erros empíricos simples, então as faixas acima não mudaram."
              : `${d(meta.intervals.method)}, que substituiu os erros empíricos.`}{" "}
            A comparação está na página do histórico.
          </p>
          <p>
            Os rótulos mostram a taxa de acerto de fato alcançada ao lado do nível nominal, inclusive no holdout desde{" "}
            {f.date(meta.splits.holdout_start)}, que não foi usado para escolher nenhum modelo (o autor já tinha visto os preços
            de 2024–25, então não é um teste cego). Com {meta.calibration_window} erros, cada limite de 95% se apoia em cerca de
            uma ou duas observações passadas, e as janelas sobrepostas deixam cerca de {indep6} resultados independentes em 6
            meses, então as caudas de 95% são aproximadas.
          </p>
          <p>
            As previsões são testadas a partir do fechamento de cada dia de divulgação do WASDE. A previsão ao vivo é emitida a
            partir do último fechamento, {meta.days_since_report} dias depois do relatório de{" "}
            {f.date(meta.latest_wasde.release_date)}.
          </p>
        </Block>

        <Block title="Unidades">
          <p>
            FOB USD/t = (CBOT ¢/bu + o seu prêmio ¢/bu) ÷ 100 × {f.num(meta.consts.bu_per_t, 4)} bushels por tonelada (exato: 1
            bu de soja = 60 lb, 1 lb = 0,45359237 kg); sem prêmio, o mesmo cálculo com prêmio zero dá a CBOT em USD/t. Reais por
            saca de {meta.consts.sack_kg} kg = USD/t × 0,06 × reais por dólar; o câmbio padrão é a PTAX de venda do Banco
            Central. Com prêmio, são valores FOB no porto, que incluem o fobbing (custo de elevação e embarque), não preços na
            fazenda nem o preço pago ao vendedor no porto. O desconto porto-interior opcional é um número seu, sem padrão
            regional, e só se aplica ao FOB.
          </p>
        </Block>

        <Block title="O que fica de fora">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Expectativas de analistas: uma &ldquo;surpresa&rdquo; do WASDE aqui é uma revisão contra o relatório anterior,
              não contra o consenso.
            </li>
            <li>A dinâmica própria do prêmio (frete, calendário da safra brasileira, demanda da China) e o câmbio.</li>
            <li>
              Rolagens de contrato: o primeiro vencimento contínuo do Yahoo salta no vencimento. Janelas que cruzam as rolagens
              de julho a setembro também medem o spread safra velha/safra nova; métricas sem elas estão em{" "}
              <A href="/data/metrics.csv">metrics.csv</A>. As outras rolagens (maio, novembro) também causam saltos menores.
            </li>
            <li>Impostos, logística e custos da fazenda ao porto.</li>
          </ul>
        </Block>

        <Block title="Dados e licenças">
          <ul className="list-disc space-y-1 pl-5">
            <li>USDA WASDE: obra do governo dos EUA, domínio público, via o histórico do WASDE Tracker.</li>
            <li>PTAX do Banco Central do Brasil (série SGS 1): dados abertos públicos do BCB.</li>
            <li>
              Futuros de soja da CBOT (ZS=F): cotações com atraso do Yahoo Finance, originadas na CME Group. Usadas para
              pesquisa sob os termos deles; o histórico bruto de preços não é redistribuído no repositório.
            </li>
            <li>
              Prêmio de Paranaguá: não é distribuído. Não há fonte licenciada, então o repositório não traz dados de prêmio,
              nem brutos nem derivados; o prêmio é só o número que você digita, guardado apenas no seu navegador. Uma série
              pública (por exemplo, um prêmio implícito do CEPEA) está no roteiro.
            </li>
          </ul>
          <p>
            Detalhes completos em <A href={LICENSES}>DATA_LICENSES.md</A>.
          </p>
        </Block>

        <Block title="Sobre" id="about">
          <p>
            Feito por <strong className="text-ink">{AUTHOR.name}</strong>, coordenador de risco de mercado no agronegócio
            brasileiro (derivativos de commodities, câmbio, VaR), como projeto de portfólio em pesquisa quantitativa e
            engenharia de dados. Reconstruí o projeto a partir de uma versão anterior cujo resultado principal se revelou
            vazamento de dados (abaixo); o objetivo desta é uma previsão que diz com que frequência as suas faixas de fato
            acertaram.
          </p>
          {links}
          <p>
            <strong className="text-ink">Aviso.</strong> Uso apenas para pesquisa e educação; não é recomendação de
            investimento, de operação ou de hedge, nem oferta de compra ou venda de nada. Os preços da CBOT têm atraso, e os
            valores FOB só aparecem com a cotação de prêmio que você mesmo informar. As faixas descrevem o tamanho dos erros de previsão passados; não são garantia sobre preços
            futuros. Sem vínculo com o USDA, a CME Group, o Banco Central do Brasil ou qualquer trading.
          </p>
        </Block>

        <Block title="O que mudou desde a primeira versão">
          <p>
            A primeira versão deste projeto relatava um erro de {f.num(1.46, 2)}% contra {f.num(13.6, 1)}% de uma previsão
            ingênua. Quando a auditei, descobri que esse número vinha de vazamento: uma variável multiplicava o milho da CBOT
            pelo próprio preço da soja que se queria prever, o milho era tomado na mesma janela do alvo, e a referência
            ingênua repetia um preço de doze meses antes. Avaliado honestamente, um passeio aleatório de um mês erra cerca de{" "}
            {f.num(3.6, 1)}% e o modelo original não o superava. O app interativo mostrava dados simulados. Esta versão
            substitui tudo isso pelo pipeline descrito acima.
          </p>
        </Block>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
      <p className="text-ink-2">
        Plain language first; the technical detail follows in each section. The CBOT, WASDE and exchange-rate data are
        public and rebuilt by the open-source pipeline on every run. The Paranaguá premium has no licensed source, so no
        premium data is distributed: it is only a number you enter (see Data and licences below).
      </p>

      <Block title="What is forecast">
        <p>
          The Paranaguá FOB price is the CBOT soybean price plus the Paranaguá premium. The CBOT part is public and
          forecast here. The premium has no free, licensed feed, so it is <strong className="text-ink">your input</strong>,
          with no default: until you type your broker&apos;s quote, the page shows CBOT in ¢/bu, in USD/t and in R$/sack at
          PTAX (CBOT only, excl. premium); FOB appears only once you enter a premium, held flat for every horizon.
        </p>
        <p>
          Technically: for every WASDE release since July 2010, the target is the log change of the CBOT front-month close
          from the release day to the last session on or before 1, 3 and 6 calendar months later. The release-day close
          is part of the information set (USDA publishes at 12:00 ET, CBOT closes at 13:20 CT).
        </p>
      </Block>

      <Block title="Only what was known that day">
        <p>
          Every WASDE value is the one published in that report, never a later revision. They come from the{" "}
          <A href="https://wasde-tracker.vercel.app">WASDE Tracker</A> history ({meta.wasde_source.reports} reports, release{" "}
          {meta.wasde_source.tag ?? "local"}, file pinned by sha256). The projected marketing year is the latest one in each
          report; it rolls forward in May, so revisions are computed only within the same marketing year and a May dummy
          marks the switch.
        </p>
        <p>
          Purging rule: when a forecast is made on day t, any past row used to fit a model, choose a penalty or set a
          range must have its outcome dated on or before t. Report dates are irregular, so the rule is applied on dates,
          not on row counts. Unit tests enforce it.
        </p>
      </Block>

      <Block title="Models, from simplest up">
        <ol className="list-decimal space-y-1 pl-5">
          {Object.entries(meta.models).map(([id, label]) => (
            <li key={id}>{label}</li>
          ))}
        </ol>
        <p>
          The WASDE model uses a feature set fixed in advance (no data-driven selection): {features}. Features are
          standardised inside each training window; the ridge penalty is chosen on a purged inner split. ARIMA(0,1,1)
          without drift forecasts the same level at every horizon, so its 3- and 6-month forecasts equal its 1-step
          forecast.
        </p>
        <p>
          A model replaces &ldquo;no change&rdquo; at a horizon only if it beats it on the validation period with a
          Clark-West test (the right test when one model nests the other), Holm-adjusted across all nine model × horizon
          tests at p &lt; {meta.champion_alpha}, and only if its {meta.inference_rule.primary_loss} is also lower.
          Diebold-Mariano tests with the Harvey-Leybourne-Newbold correction and Newey-West variance are reported
          alongside, on the same primary loss and, as a secondary check, on the {meta.inference_rule.secondary_loss}.
          Current winners: {champions}.
        </p>
        <p>
          This is inference rule v{meta.inference_rule.version}, fixed on {f.date(meta.inference_rule.registered)}. The
          first version mixed losses: Diebold-Mariano on absolute USD/t errors, Clark-West on squared log-return errors, and
          a tie-break on mean absolute error. A model could then pass one test and fail another for reasons of units alone.
          Version 2 uses one primary loss, keeps the absolute error as secondary, adjusts for all nine tests at once, and
          tests direction with a Pesaran-Timmermann test with overlap-robust (HAC) errors instead of a binomial test that
          ignores overlapping windows. No conclusion changed: no model beats no change under either rule.
        </p>
      </Block>

      <Block title="Ranges">
        <p>
          The 80% and 95% ranges are {meta.intervals.method}: quantiles of the last {meta.calibration_window} realized
          out-of-sample errors of the winning model at that horizon
          {meta.intervals.centring === "median" ? ", centred on their median so the band does not carry a past drift" : ""}.
          This is not split-conformal: 3- and 6-month windows overlap, so the errors are not exchangeable and no
          finite-sample guarantee is claimed. The centring was chosen between {meta.intervals.candidates.join(" and ")} by a
          rule fixed in advance (interval score on the validation period only).
        </p>
        <p>
          Two volatility-scaled alternatives were fixed in advance and scored the same way: {meta.intervals.range_labels.ewma_fhs}{" "}
          and a {meta.intervals.range_labels.lognormal_rv}. Only the validation winner is published:{" "}
          {sameMethod
            ? "neither beat the plain empirical errors, so the ranges above are unchanged."
            : `the ${meta.intervals.method}, which replaced the empirical errors.`}{" "}
          The comparison is on the track record page.
        </p>
        <p>
          The labels show the hit rate actually achieved, next to the nominal level, including on the holdout since{" "}
          {f.date(meta.splits.holdout_start)}, which was not used for any model choice (the author had seen 2024–25 prices,
          so it is not a blind test). With {meta.calibration_window} errors, each 95% bound rests on about one or two past
          observations, and overlapping windows leave about {indep6} independent outcomes at 6 months, so the 95% tails are
          rough.
        </p>
        <p>
          Forecasts are tested from the close of each WASDE release day. The live forecast is issued from the latest close,{" "}
          {meta.days_since_report} days after the {f.date(meta.latest_wasde.release_date)} report.
        </p>
      </Block>

      <Block title="Units">
        <p>
          FOB USD/t = (CBOT ¢/bu + your premium ¢/bu) ÷ 100 × {f.num(meta.consts.bu_per_t, 4)} bushels per tonne (exact: 1
          bu of soybeans = 60 lb, 1 lb = 0.45359237 kg); with no premium, the same sum with a zero premium is CBOT in USD/t.
          Reais per {meta.consts.sack_kg} kg sack = USD/t × 0.06 × BRL per USD; the default rate is the Banco Central PTAX
          selling rate. With a premium these are port FOB values, which include fobbing (port elevation and loading), not
          farm-gate prices nor what a seller is paid at the port. The optional port-to-interior discount is your own
          number, with no regional default, and applies to FOB only.
        </p>
      </Block>

      <Block title="What this leaves out">
        <ul className="list-disc space-y-1 pl-5">
          <li>Analyst expectations: a WASDE &ldquo;surprise&rdquo; here is a revision versus the previous report, not versus consensus.</li>
          <li>The premium&apos;s own dynamics (freight, Brazilian crop timing, China demand) and the exchange rate.</li>
          <li>
            Contract rolls: the Yahoo continuous front month jumps at expiry. Windows crossing the July–September rolls
            also measure the old-crop/new-crop spread; metrics without them are in <A href="/data/metrics.csv">metrics.csv</A>.
            Other rolls (May, November) also cause smaller jumps.
          </li>
          <li>Taxes, logistics and costs from farm to port.</li>
        </ul>
      </Block>

      <Block title="Data and licences">
        <ul className="list-disc space-y-1 pl-5">
          <li>USDA WASDE: US government work, public domain, via the WASDE Tracker history.</li>
          <li>Banco Central do Brasil PTAX (SGS series 1): public open data from the BCB.</li>
          <li>
            CBOT soybean futures (ZS=F): delayed quotes from Yahoo Finance, originating from CME Group. Used for research
            under their terms; the raw price history is not redistributed in the repository.
          </li>
          <li>
            Paranaguá premium: not distributed. There is no licensed source, so the repository ships no premium data, raw
            or derived; the premium is only the number you type, kept in your browser. A public series (for example a
            CEPEA-implied premium) is on the roadmap.
          </li>
        </ul>
        <p>
          Full details are in <A href={LICENSES}>DATA_LICENSES.md</A>.
        </p>
      </Block>

      <Block title="About" id="about">
        <p>
          Built by <strong className="text-ink">{AUTHOR.name}</strong>, market risk coordinator in Brazilian
          agribusiness (commodity derivatives, FX, VaR), as a portfolio project in quantitative research and data
          engineering. I rebuilt it from an earlier version whose headline result turned out to be leakage (below); the
          point of this one is a forecast that says how often its ranges have actually held.
        </p>
        {links}
        <p>
          <strong className="text-ink">Disclaimer.</strong> Research and educational use only; not investment, trading or
          hedging advice, and not an offer to buy or sell anything. CBOT prices are delayed, and FOB values appear only with
          a premium quote you enter yourself. The ranges describe
          how large past forecast errors were; they are not a guarantee about future prices. No affiliation with USDA,
          CME Group, Banco Central do Brasil or any trading company.
        </p>
      </Block>

      <Block title="What changed from the first version">
        <p>
          The first version of this project reported a 1.46% error against 13.6% for a naive forecast. When I audited it, I
          found that number came from leakage: a feature multiplied CBOT corn by the soybean price being predicted, corn was
          taken over the same window as the target, and the naive benchmark repeated a price from twelve months earlier.
          Scored honestly, a one-month random walk misses by about 3.6% and the original model did not beat it. The
          interactive app showed simulated data. This version replaces all of it with the pipeline described above.
        </p>
      </Block>
    </div>
  );
}
