"""Unit conversions, from exact definitions (1 lb = 0.45359237 kg, 1 bu soybeans = 60 lb)."""

from __future__ import annotations

BUSHELS_PER_TONNE = 1000 / (0.45359237 * 60)  # 36.7437...
SACK_KG = 60


def c_bu_to_usd_t(cents_per_bushel: float) -> float:
    """CBOT soybean quote in US cents per bushel -> US dollars per metric tonne."""
    return cents_per_bushel / 100 * BUSHELS_PER_TONNE


def usd_t_to_brl_sack(usd_per_tonne: float, brl_per_usd: float) -> float:
    """US dollars per tonne -> Brazilian reais per 60 kg sack."""
    return usd_per_tonne * SACK_KG / 1000 * brl_per_usd


def fob_usd_t(cbot_c_bu: float, premium_c_bu: float) -> float:
    """Paranaguá FOB in USD/t: CBOT plus the port premium, both in cents per bushel."""
    return c_bu_to_usd_t(cbot_c_bu + premium_c_bu)
