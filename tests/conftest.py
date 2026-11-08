from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from soyforecast import fixtures

FIXTURES = Path(__file__).parent / "fixtures" / "bronze"
# Built on the day of the fixtures' last close, as the scheduled refresh would be.
FIXTURE_NOW = datetime(2026, 11, 6, 21, tzinfo=UTC)


@pytest.fixture(scope="session")
def _wasde_once() -> pd.DataFrame:
    return fixtures.synthetic_wasde()


@pytest.fixture(scope="session")
def _prices_once() -> pd.Series:
    return fixtures.synthetic_prices()


@pytest.fixture
def synthetic_wasde(_wasde_once) -> pd.DataFrame:
    """Monthly reports 2010-07..2026-10; the projected MY rolls every May (a fresh copy)."""
    return _wasde_once.copy()


@pytest.fixture
def synthetic_prices(_prices_once) -> pd.Series:
    """Business-day random walk in cents per bushel, 2004 to 2026-11-06 (a fresh copy)."""
    return _prices_once.copy()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Tests that need the full offline pipeline run are slow (deselect with -m "not slow")."""
    for item in items:
        if "fixture_run" in getattr(item, "fixturenames", ()) or "published" in getattr(
            item, "fixturenames", ()
        ):
            item.add_marker(pytest.mark.slow)


@pytest.fixture(scope="session")
def fixture_run(tmp_path_factory) -> tuple[Any, Any]:
    """One offline pipeline run on the committed synthetic fixtures (what CI does), shared by
    every test that needs artefacts: (Artefacts, Settings). Treat both as read-only."""
    from soyforecast.config import ROOT, Settings
    from soyforecast.pipeline import run

    base = tmp_path_factory.mktemp("ci")
    shutil.copytree(FIXTURES, base / "data" / "bronze")
    shutil.copytree(ROOT / "data" / "seed", base / "data" / "seed")
    settings = Settings(data_dir=base / "data", web_data_dir=base / "web", offline=True)
    return run(settings), settings


@pytest.fixture(scope="session")
def published(fixture_run) -> Path:
    """The published site data of that run. Read-only: copy it before changing anything."""
    from soyforecast.publish.web_json import publish

    artefacts, settings = fixture_run
    publish(artefacts, settings, now=FIXTURE_NOW)
    return settings.web_data_dir
