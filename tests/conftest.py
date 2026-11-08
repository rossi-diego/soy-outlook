from __future__ import annotations

import pandas as pd
import pytest

from soyforecast import fixtures


@pytest.fixture
def synthetic_wasde() -> pd.DataFrame:
    """Monthly reports 2010-07..2026-10; the projected MY rolls every May."""
    return fixtures.synthetic_wasde()


@pytest.fixture
def synthetic_prices() -> pd.Series:
    """Business-day random walk in cents per bushel, 2004 to 2026-11-06."""
    return fixtures.synthetic_prices()
