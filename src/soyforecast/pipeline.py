"""End-to-end run: ingest -> silver -> gold -> backtest -> live forecast -> artefacts."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pandas as pd

from soyforecast.config import Settings
from soyforecast.evaluation.backtest import fob_illustrative, run_backtest, summarize
from soyforecast.features.dataset import build_dataset, live_row
from soyforecast.features.vintages import build_vintages
from soyforecast.ingest.fx import fetch_ptax
from soyforecast.ingest.premium import load_premium
from soyforecast.ingest.prices import fetch_soy_prices
from soyforecast.ingest.wasde import fetch_wasde, load_wasde
from soyforecast.logs import get_logger
from soyforecast.models.live import evidence, live_forecast, release_day_reaction

log = get_logger(__name__)


@dataclass
class Artefacts:
    wasde_manifest: dict[str, Any]
    vintages: pd.DataFrame
    prices: pd.Series
    ptax: pd.Series
    premium: pd.Series
    dataset: pd.DataFrame
    live: pd.Series
    backtest: pd.DataFrame
    metrics: pd.DataFrame
    tests: pd.DataFrame
    champion: dict[int, str]
    fob: pd.DataFrame
    forecast: list[dict[str, object]]
    evidence: list[dict[str, object]]
    reaction: dict[str, object]


def ingest(
    settings: Settings,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.Series, dict[str, Any]]:
    settings.ensure()
    wasde = load_wasde(fetch_wasde(settings))
    manifest = json.loads((settings.bronze / "wasde_manifest.json").read_text())
    prices = fetch_soy_prices(settings.bronze, offline=settings.offline)
    ptax = fetch_ptax(settings.bronze, offline=settings.offline)
    premium = load_premium(settings.premium_seed)
    return wasde, prices, ptax, premium, manifest


def run(settings: Settings) -> Artefacts:
    wasde, prices, ptax, premium, manifest = ingest(settings)
    vintages = build_vintages(wasde)
    vintages.to_parquet(settings.silver / "wasde_vintages.parquet")
    dataset = build_dataset(vintages, prices)
    dataset.to_parquet(settings.gold / "dataset.parquet")
    log.info("gold.dataset", rows=len(dataset), first=str(dataset["origin"].min().date()))

    bt = run_backtest(dataset)
    bt.to_parquet(settings.gold / "backtest.parquet")
    metrics, champion, tests = summarize(bt)
    metrics.to_csv(settings.gold / "metrics.csv", index=False)
    tests.to_csv(settings.gold / "tests.csv", index=False)
    fob = fob_illustrative(bt, premium, champion)

    live = live_row(vintages, prices)
    forecast = live_forecast(dataset, live, bt, champion)
    ev = evidence(dataset, float(live["p0_c_bu"]))
    reaction = release_day_reaction(vintages, prices, float(live["p0_c_bu"]))
    log.info("live.forecast", anchor=str(live["anchor_date"].date()), champion=champion)
    return Artefacts(
        manifest,
        vintages,
        prices,
        ptax,
        premium,
        dataset,
        live,
        bt,
        metrics,
        tests,
        champion,
        fob,
        forecast,
        ev,
        reaction,
    )
