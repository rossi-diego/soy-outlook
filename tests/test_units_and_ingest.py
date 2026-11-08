from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from soyforecast.ingest.fx import parse_ptax
from soyforecast.ingest.premium import (
    PremiumDataError,
    build_card,
    derive_monthly_table,
    load_premium_table,
    load_raw_premium,
    monthly_premium_profile,
    write_premium_table,
)
from soyforecast.ingest.prices import PriceDataError, fetch_soy_prices, price_problems
from soyforecast.units import BUSHELS_PER_TONNE, c_bu_to_usd_t, fob_usd_t, usd_t_to_brl_sack


def test_bushels_per_tonne_from_exact_definitions():
    assert pytest.approx(36.7437, abs=1e-4) == BUSHELS_PER_TONNE


def test_conversions():
    assert c_bu_to_usd_t(1000) == pytest.approx(367.437, abs=1e-3)
    assert fob_usd_t(1000, 50) == pytest.approx(c_bu_to_usd_t(1050))
    assert usd_t_to_brl_sack(400, 5.5) == pytest.approx(132.0)


def _series(values, start="2024-01-01"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype="float64")


def test_price_problems_flags_unit_jump_and_rescale():
    good = _series(np.linspace(1000, 1100, 50))
    assert price_problems(good, None) == []
    jump = good.copy()
    jump.iloc[20] = jump.iloc[20] / 100
    assert "unit jump" in price_problems(jump, None)
    assert "rescaled against the cache" in price_problems(good * 1.5, good)
    assert "too few rows against the cache" in price_problems(good.iloc[:10], good)
    assert price_problems(pd.Series(dtype="float64"), None) == ["no values"]


def test_fetch_falls_back_to_cache(tmp_path):
    good = _series(np.linspace(1000, 1100, 50))
    fetch_soy_prices(tmp_path, downloader=lambda t, s: good)
    bad = good * 100
    out = fetch_soy_prices(tmp_path, downloader=lambda t, s: bad)
    assert out.iloc[-1] == pytest.approx(1100)

    def boom(t, s):
        raise ConnectionError("down")

    assert fetch_soy_prices(tmp_path, downloader=boom).iloc[-1] == pytest.approx(1100)
    with pytest.raises(PriceDataError):
        fetch_soy_prices(tmp_path / "empty", downloader=boom)


def test_parse_ptax():
    s = parse_ptax(
        [{"data": "02/01/2026", "valor": "5.4321"}, {"data": "01/01/2026", "valor": "5.1"}]
    )
    assert list(s.index) == [pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-02")]
    assert s.iloc[-1] == pytest.approx(5.4321)
    assert parse_ptax([]).empty


def test_raw_premium_drops_placeholders(tmp_path):
    p = tmp_path / "prem.csv"
    p.write_text(
        "date,premium_c_bu\n2020-01-02,50\n2020-01-03,300\n2020-02-03,-300\n2020-02-04,70\n"
    )
    s = load_raw_premium(p)
    assert list(s.values) == [50, 70]
    prof = monthly_premium_profile(s, first_year=2015)
    assert prof.loc[1, "median"] == 50
    assert prof.loc[1, "n_years"] == 1


def _raw_premium(end: str = "2025-06-18") -> pd.Series:
    idx = pd.bdate_range("2012-01-02", end)
    return pd.Series(np.random.default_rng(5).normal(60, 25, len(idx)), index=idx)


def test_derived_table_round_trips_and_labels_years_from_data(tmp_path):
    raw = _raw_premium()
    table = derive_monthly_table(raw)
    assert len(table) == 12 and list(table["month"]) == list(range(1, 13))
    card = build_card(
        raw, table, raw_sha256="abc", derived_at=pd.Timestamp("2026-11-07"), fob_frozen=[]
    )
    write_premium_table(table, card, tmp_path / "t.csv")
    pt = load_premium_table(tmp_path / "t.csv")
    assert pt.years_label(5) == "2015-2025"
    assert pt.years_label(11) == "2015-2024"  # the series ends in June 2025
    assert pt.last_date == pd.Timestamp("2025-06-18")
    assert pt.valid_until == pd.Timestamp("2025-09-16")  # +90 days
    assert pt.is_stale(pd.Timestamp("2026-11-06"))
    assert not pt.is_stale(pd.Timestamp("2025-09-01"))
    assert card["contract_convention"] == "unknown"
    # no daily quote is in the committed files
    assert len((tmp_path / "t.csv").read_text().splitlines()) == 13


def test_premium_card_is_validated(tmp_path):
    raw = _raw_premium()
    table = derive_monthly_table(raw)
    card = build_card(
        raw, table, raw_sha256="abc", derived_at=pd.Timestamp("2026-11-07"), fob_frozen=[]
    )
    bad = {k: v for k, v in card.items() if k != "licence"}
    write_premium_table(table, bad, tmp_path / "a.csv")
    with pytest.raises(PremiumDataError, match="licence"):
        load_premium_table(tmp_path / "a.csv")
    swapped = table.copy()
    swapped.loc[0, "p10"] = swapped.loc[0, "p90"] + 1
    write_premium_table(swapped, card, tmp_path / "b.csv")
    with pytest.raises(PremiumDataError, match="p10"):
        load_premium_table(tmp_path / "b.csv")
    write_premium_table(table.iloc[:11], card, tmp_path / "c.csv")
    with pytest.raises(PremiumDataError, match="12"):
        load_premium_table(tmp_path / "c.csv")
    with pytest.raises(PremiumDataError, match="missing"):
        load_premium_table(tmp_path / "nope.csv")


def test_committed_premium_table_is_valid_and_raw_export_is_gone():
    from soyforecast.config import ROOT

    seed = ROOT / "data" / "seed"
    pt = load_premium_table(seed / "paranagua_premium_monthly.csv")
    assert len(pt.profile) == 12
    assert not (seed / "paranagua_premium.csv").exists()
