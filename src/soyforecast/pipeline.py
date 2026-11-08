"""End-to-end run: ingest -> silver -> gold -> backtest -> live forecast -> artefacts."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

from soyforecast.config import HORIZONS, WASDE_ASSET, Settings
from soyforecast.evaluation.backtest import (
    fob_illustrative,
    range_diagnostics,
    run_backtest,
    select_centring,
    select_range_method,
    summarize,
)
from soyforecast.features.dataset import build_dataset, live_row
from soyforecast.features.vintages import build_vintages
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import write_snapshot
from soyforecast.ingest.fx import fetch_ptax
from soyforecast.ingest.premium import (
    PremiumTable,
    build_card,
    derive_monthly_table,
    file_sha256,
    load_premium_table,
    load_raw_premium,
    write_premium_table,
)
from soyforecast.ingest.prices import fetch_soy_prices
from soyforecast.ingest.wasde import fetch_wasde, load_wasde
from soyforecast.logs import get_logger
from soyforecast.models.live import evidence, live_forecast, release_day_reaction
from soyforecast.models.stress import stress_replay

log = get_logger(__name__)


@dataclass
class Artefacts:
    wasde_manifest: dict[str, Any]
    vintages: pd.DataFrame
    prices: pd.Series
    ptax: pd.Series
    premium: PremiumTable
    dataset: pd.DataFrame
    live: pd.Series
    backtest: pd.DataFrame
    metrics: pd.DataFrame
    tests: pd.DataFrame
    champion: dict[int, str]
    forecast: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    reaction: dict[str, Any]
    centring: str
    interval_choice: pd.DataFrame
    range_method: str
    range_choice: pd.DataFrame
    range_diagnostics: pd.DataFrame
    range_regimes: pd.DataFrame
    stress: dict[str, Any]
    sources: SourceLog
    offline: bool


def ingest(
    settings: Settings,
    sources: SourceLog | None = None,
    *,
    update_pin: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, PremiumTable, dict[str, Any]]:
    """Bronze layer. `transport` replaces the network in tests (httpx.MockTransport)."""
    settings.ensure()
    wasde_path = fetch_wasde(settings, sources, update_pin=update_pin, transport=transport)
    wasde = load_wasde(wasde_path)
    manifest = json.loads((settings.bronze / "wasde_manifest.json").read_text(encoding="utf-8"))
    prices = fetch_soy_prices(settings.bronze, offline=settings.offline, sources=sources)
    ptax = fetch_ptax(
        settings.bronze, offline=settings.offline, sources=sources, transport=transport
    )
    premium = load_premium_table(settings.premium_table, settings.premium_card)
    snapshot_inputs(settings.bronze)
    return wasde, prices, ptax, premium, manifest


BRONZE_INPUTS = (WASDE_ASSET, "zs_daily.parquet", "ptax_daily.parquet")


def snapshot_inputs(bronze: Path) -> None:
    """Snapshot the bronze files this run actually uses, in every mode (P24).

    A live download is snapshotted when it is accepted; an offline or cache-fallback run uses
    bytes that may predate snapshots, so they are kept too, dated by when they entered the cache
    (the file's modification time). Identical bytes are stored once, so this is a no-op when
    nothing changed, and run_manifest.json can always name the snapshot behind an outlook.
    """
    for name in BRONZE_INPUTS:
        path = bronze / name
        if path.exists():
            written = datetime.fromtimestamp(path.stat().st_mtime, UTC).date()
            write_snapshot(path, day=written)


def run(settings: Settings, *, update_pin: bool = False) -> Artefacts:
    sources = SourceLog()
    wasde, prices, ptax, premium, manifest = ingest(settings, sources, update_pin=update_pin)
    vintages = build_vintages(wasde)
    vintages.to_parquet(settings.silver / "wasde_vintages.parquet")
    dataset = build_dataset(vintages, prices)
    dataset.to_parquet(settings.gold / "dataset.parquet")
    log.info("gold.dataset", rows=len(dataset), first=str(dataset["origin"].min().date()))

    bt, centring, interval_choice = select_centring(run_backtest(dataset))
    bt, range_method, range_choice, variants = select_range_method(bt, centring)
    bt.to_parquet(settings.gold / "backtest.parquet")
    interval_choice.to_csv(settings.gold / "interval_choice.csv", index=False)
    range_choice.to_csv(settings.gold / "range_choice.csv", index=False)
    metrics, champion, tests = summarize(bt)
    metrics.to_csv(settings.gold / "metrics.csv", index=False)
    tests.to_csv(settings.gold / "tests.csv", index=False)
    diag, regimes = range_diagnostics(variants, champion)
    diag.to_csv(settings.gold / "range_diagnostics.csv", index=False)

    live = live_row(vintages, prices)
    forecast = live_forecast(dataset, live, bt, champion, centring, range_method)
    stress = stress_replay(prices, float(live["p0_c_bu"]), float(ptax.iloc[-1]))
    ev = evidence(dataset, float(live["p0_c_bu"]))
    reaction = release_day_reaction(vintages, prices, float(live["p0_c_bu"]))
    log.info("live.forecast", anchor=str(live["anchor_date"].date()), champion=champion)
    return Artefacts(
        wasde_manifest=manifest,
        vintages=vintages,
        prices=prices,
        ptax=ptax,
        premium=premium,
        dataset=dataset,
        live=live,
        backtest=bt,
        metrics=metrics,
        tests=tests,
        champion=champion,
        forecast=forecast,
        evidence=ev,
        reaction=reaction,
        centring=centring,
        interval_choice=interval_choice,
        range_method=range_method,
        range_choice=range_choice,
        range_diagnostics=diag,
        range_regimes=regimes,
        stress=stress,
        sources=sources,
        offline=settings.offline,
    )


def derive_premium(settings: Settings, raw_path: Path) -> Path:
    """Regenerate the derived premium table and card from a private raw export.

    Also freezes the illustrative FOB backtest of the random walk (premium held at its
    report-day value), the only result that needs the daily series. The random walk's
    forecasts do not depend on any fitted parameter, so the frozen rows stay valid.
    """
    raw = load_raw_premium(raw_path)
    table = derive_monthly_table(raw)
    settings.ensure()
    vintages = build_vintages(load_wasde(fetch_wasde(settings)))
    prices = fetch_soy_prices(settings.bronze, offline=settings.offline)
    bt = run_backtest(build_dataset(vintages, prices), models=("rw",))
    fob = fob_illustrative(bt, raw, dict.fromkeys(HORIZONS, "rw"))
    fob_rows = [
        {
            str(k): int(v) if k in ("h", "n") else round(v, 3) if isinstance(v, float) else v
            for k, v in r.items()
        }
        for r in fob.to_dict(orient="records")
    ]
    card = build_card(
        raw,
        table,
        raw_sha256=file_sha256(raw_path),
        derived_at=pd.Timestamp.now(),
        fob_frozen=fob_rows,
    )
    card_path = write_premium_table(table, card, settings.premium_table)
    log.info(
        "premium.derived",
        table=str(settings.premium_table),
        card=str(card_path),
        rows=len(table),
        last=card["series"]["last"],
    )
    return card_path
