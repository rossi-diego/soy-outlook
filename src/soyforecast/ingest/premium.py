"""Paranaguá FOB soybean premium: a derived 12-row monthly profile and its data card.

The premium (US cents per bushel over CBOT) has no free, licensed, machine-readable feed. The
author holds a daily terminal export (2004-2025) whose vendor, assessment method and CBOT
reference contract are not recorded, and whose redistribution licence is not confirmed. That
raw export is **not** part of the repository. Only aggregate statistics derived from it are:

* ``paranagua_premium_monthly.csv`` - per calendar month, the median and 10th/90th percentile
  of daily quotes from PREMIUM_PROFILE_FIRST_YEAR on, with the number of quotes and years;
* ``paranagua_premium_monthly.meta.json`` - the data card: source, unit, contract convention,
  validity, licence note, the last quote of the original series, and the frozen summary of the
  illustrative FOB backtest (which needed the daily series and cannot be recomputed without it).

``derive_monthly_table`` and ``build_card`` regenerate both from a private raw file
(``soyforecast derive-premium --raw PATH``); the pipeline only ever reads them back through
``load_premium_table``, which validates the card.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from soyforecast.config import PREMIUM_PROFILE_FIRST_YEAR, STALE_PREMIUM_DAYS

PREMIUM_LIMIT_C_BU = 300  # quotes at exactly +/-300 look like terminal placeholders
CARD_SCHEMA = 1
TABLE_COLUMNS = ("month", "median", "p10", "p90", "n_obs", "n_years", "first_year", "last_year")
CARD_REQUIRED = (
    "card_schema",
    "name",
    "source",
    "unit",
    "contract_convention",
    "method",
    "series",
    "premium_last",
    "valid_until",
    "licence",
    "provenance",
)


class PremiumDataError(ValueError):
    """The derived premium table or its data card is missing or inconsistent."""


@dataclass(frozen=True)
class PremiumTable:
    """The monthly profile (indexed by calendar month 1-12) and its validated data card."""

    profile: pd.DataFrame
    card: dict[str, Any]

    @property
    def last_date(self) -> pd.Timestamp:
        return pd.Timestamp(self.card["premium_last"]["date"])

    @property
    def last_c_bu(self) -> float:
        return float(self.card["premium_last"]["c_bu"])

    @property
    def valid_until(self) -> pd.Timestamp:
        return pd.Timestamp(self.card["valid_until"])

    def years_label(self, month: int) -> str:
        r = self.profile.loc[month]
        return f"{int(r['first_year'])}-{int(r['last_year'])}"

    def is_stale(self, as_of: pd.Timestamp) -> bool:
        return bool(pd.Timestamp(as_of) > self.valid_until)


# --- deriving (needs the private raw export) --------------------------------------------------


def load_raw_premium(path: Path) -> pd.Series:
    """Daily raw export (date, premium_c_bu); placeholders and duplicate dates dropped."""
    df = pd.read_csv(path, parse_dates=["date"])
    s = df.set_index("date")["premium_c_bu"].astype("float64").sort_index()
    s = s[s.abs() < PREMIUM_LIMIT_C_BU]
    return s[~s.index.duplicated(keep="last")]


def monthly_premium_profile(
    premium: pd.Series, first_year: int = PREMIUM_PROFILE_FIRST_YEAR
) -> pd.DataFrame:
    """Median and 10th/90th percentile premium per calendar month, from first_year on."""
    p = premium[premium.index.year >= first_year]
    g = p.groupby(p.index.month)
    years = pd.Series(p.index.year, index=p.index).groupby(p.index.month)
    out = pd.DataFrame(
        {
            "median": g.median(),
            "p10": g.quantile(0.10),
            "p90": g.quantile(0.90),
            "n_obs": g.size(),
            "n_years": years.nunique(),
            "first_year": years.min(),
            "last_year": years.max(),
        }
    )
    out.index.name = "month"
    return out


def derive_monthly_table(
    raw: pd.Series, first_year: int = PREMIUM_PROFILE_FIRST_YEAR
) -> pd.DataFrame:
    """The 12-row table that is committed instead of the daily quotes."""
    prof = monthly_premium_profile(raw, first_year)
    if list(prof.index) != list(range(1, 13)):
        raise PremiumDataError(f"raw premium does not cover all 12 months: {list(prof.index)}")
    out = prof.reset_index()
    for c in ("median", "p10", "p90"):
        out[c] = out[c].round(1)
    return out[list(TABLE_COLUMNS)]


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_card(
    raw: pd.Series,
    table: pd.DataFrame,
    *,
    raw_sha256: str,
    derived_at: pd.Timestamp,
    fob_frozen: list[dict[str, Any]],
) -> dict[str, Any]:
    last_date = pd.Timestamp(raw.index.max())
    return {
        "card_schema": CARD_SCHEMA,
        "name": "Paranaguá FOB soybean premium, monthly profile (derived)",
        "source": (
            "Daily quotes exported from a market terminal by the author. Vendor, assessment "
            "method and the CBOT contract each quote refers to were not recorded."
        ),
        "unit": "US cents per bushel over CBOT soybean futures",
        "contract_convention": "unknown",
        "method": (
            f"Per calendar month: median and 10th/90th percentile of daily quotes from "
            f"{int(table['first_year'].min())} to {int(table['last_year'].max())}; quotes with "
            f"|premium| >= {PREMIUM_LIMIT_C_BU} c/bu dropped as terminal placeholders."
        ),
        "series": {
            "first": pd.Timestamp(raw.index.min()).date().isoformat(),
            "last": last_date.date().isoformat(),
            "n_obs": len(raw),
            "raw_sha256": raw_sha256,
        },
        "premium_last": {"date": last_date.date().isoformat(), "c_bu": round(float(raw.iloc[-1]))},
        "valid_until": (last_date + pd.Timedelta(days=STALE_PREMIUM_DAYS)).date().isoformat(),
        "licence": (
            "Only these aggregate statistics are published, for illustration. The daily quotes "
            "are not redistributed, and permission to redistribute the original export has not "
            "been confirmed. Do not treat these numbers as a market assessment."
        ),
        "provenance": (
            "The raw daily export was removed from the repository working tree when this table was "
            "first derived (2026-11-07). Earlier commits still contain it; rewriting git "
            "history is a separate decision for the owner, and existing clones keep the old "
            "file regardless. raw_sha256 identifies the exact file the table was derived from."
        ),
        "derived_at": pd.Timestamp(derived_at).date().isoformat(),
        "derived_by": "soyforecast derive-premium --raw <path>",
        "fob_illustrative_frozen": {
            "note": (
                "Illustrative FOB backtest of the random walk with the premium held at its "
                "report-day value. Computed once from the daily series at derivation time; it "
                "cannot be recomputed from the monthly table."
            ),
            "rows": fob_frozen,
        },
    }


def write_premium_table(table: pd.DataFrame, card: dict[str, Any], table_path: Path) -> Path:
    """Write the CSV and its card next to it; returns the card path."""
    table_path.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(table_path, index=False)
    card_path = table_path.with_suffix(".meta.json")
    card_path.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return card_path


# --- reading (what the pipeline uses) ---------------------------------------------------------


def _validate(profile: pd.DataFrame, card: dict[str, Any]) -> None:
    missing = [k for k in CARD_REQUIRED if k not in card]
    if missing:
        raise PremiumDataError(f"premium data card is missing {missing}")
    if card["card_schema"] != CARD_SCHEMA:
        raise PremiumDataError(f"premium card_schema {card['card_schema']} != {CARD_SCHEMA}")
    if list(profile.index) != list(range(1, 13)):
        raise PremiumDataError("premium table must have exactly one row per month 1-12")
    if profile[["median", "p10", "p90"]].isna().any().any():
        raise PremiumDataError("premium table has missing values")
    if not ((profile["p10"] <= profile["median"]) & (profile["median"] <= profile["p90"])).all():
        raise PremiumDataError("premium table must satisfy p10 <= median <= p90")
    if (profile["median"].abs() >= PREMIUM_LIMIT_C_BU).any():
        raise PremiumDataError("premium medians look like placeholders")
    last = pd.Timestamp(card["premium_last"]["date"])
    if last != pd.Timestamp(card["series"]["last"]):
        raise PremiumDataError("premium_last.date must equal series.last")
    if pd.Timestamp(card["valid_until"]) < last:
        raise PremiumDataError("valid_until is before the last quote")
    if int(profile["last_year"].max()) > last.year:
        raise PremiumDataError("table covers years after the series ends")


def load_premium_table(table_path: Path, card_path: Path | None = None) -> PremiumTable:
    card_path = card_path or table_path.with_suffix(".meta.json")
    if not table_path.exists() or not card_path.exists():
        raise PremiumDataError(f"missing premium table or card: {table_path}, {card_path}")
    df = pd.read_csv(table_path)
    if tuple(df.columns) != TABLE_COLUMNS:
        raise PremiumDataError(f"premium table columns {tuple(df.columns)} != {TABLE_COLUMNS}")
    profile = df.set_index("month").sort_index()
    card = json.loads(card_path.read_text(encoding="utf-8"))
    _validate(profile, card)
    return PremiumTable(profile=profile, card=card)
