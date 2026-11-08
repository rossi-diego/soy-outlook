"""P24: pinned WASDE input, WASDE/PTAX checks with cache fallback, offline semantics, exit codes.

Every network call goes through httpx.MockTransport; nothing here touches a real endpoint.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
from dataclasses import replace
from pathlib import Path

import httpx
import pandas as pd
import pytest
from typer.testing import CliRunner

from soyforecast import fixtures
from soyforecast.cli import app
from soyforecast.config import Settings
from soyforecast.errors import ContractError, InputDataError
from soyforecast.freshness import SourceLog
from soyforecast.ingest.fx import FxDataError, fetch_ptax, ptax_problems
from soyforecast.ingest.wasde import (
    WasdeDataError,
    WasdePin,
    fetch_wasde,
    load_pin,
    wasde_problems,
    write_pin,
)
from soyforecast.logs import configure_logging, get_logger

BASE = "https://example.test/releases"
FIXTURES = Path(__file__).parent / "fixtures" / "bronze"


def _parquet(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def wasde_bytes() -> dict[str, bytes]:
    full = fixtures.synthetic_wasde()
    short = full[full["report_month"] < "2026-01"]
    return {"full": _parquet(full), "short": _parquet(short)}


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class Tracker:
    """A fake WASDE Tracker release host: tag -> parquet bytes, plus meta.json per tag."""

    def __init__(self, assets: dict[str, bytes], latest: str, fail: bool = False) -> None:
        self.assets, self.latest, self.fail = assets, latest, fail
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(path)
        if self.fail:
            return httpx.Response(503)
        if path.endswith("/latest/download/meta.json"):
            return httpx.Response(
                200, json={"data_release_tag": self.latest, "next_release": "2026-11-10"}
            )
        tag = path.split("/download/")[1].split("/")[0]
        if path.endswith("/meta.json"):
            return httpx.Response(200, json={"data_release_tag": tag, "next_release": "2026-11-10"})
        if tag in self.assets:
            return httpx.Response(200, content=self.assets[tag])
        return httpx.Response(404)


def _settings(tmp_path: Path, **kw: object) -> Settings:
    base = Settings(
        data_dir=tmp_path / "data",
        web_data_dir=tmp_path / "web",
        wasde_releases_url=BASE,
        wasde_lock=tmp_path / "wasde.lock.json",
        wasde_local=None,
        offline=False,
    )
    return replace(base, **kw)


def _pin(tag: str, content: bytes) -> WasdePin:
    return WasdePin(tag, "wasde_full.parquet", _sha(content), len(content), 0, "", "")


# ---------------------------------------------------------------- WASDE


def test_wasde_problems_checks_columns_dtypes_keys_and_regressions(synthetic_wasde):
    assert wasde_problems(synthetic_wasde) == []
    assert wasde_problems(synthetic_wasde.drop(columns="value"))[0].startswith("missing columns")
    bad = synthetic_wasde.copy()
    bad["value"] = bad["value"].astype(str)
    bad.loc[0, "report_month"] = "2010/07"
    problems = wasde_problems(pd.concat([bad, bad.iloc[:3]]))
    assert any("not numeric" in p for p in problems)
    assert any("YYYY-MM" in p for p in problems)
    assert any("3 duplicated keys" in p for p in problems)
    cached = {"reports": 999, "latest_report": "2030-01"}
    problems = wasde_problems(synthetic_wasde, cached)
    assert any("fewer than the cache" in p for p in problems)
    assert any("older than the cache" in p for p in problems)


def test_pinned_download_accepts_only_the_pinned_bytes(tmp_path, wasde_bytes):
    full = wasde_bytes["full"]
    settings = _settings(tmp_path)
    write_pin(_pin("data-2026-10", full), settings.wasde_lock)
    host = Tracker({"data-2026-10": full}, latest="data-2026-11")
    sources = SourceLog()
    path = fetch_wasde(settings, sources, transport=httpx.MockTransport(host))
    manifest = json.loads((settings.bronze / "wasde_manifest.json").read_text())
    assert path.read_bytes() == full
    assert manifest["release_tag"] == "data-2026-10" and manifest["sha256"] == _sha(full)
    assert manifest["next_release"] == "2026-11-10" and manifest["reports"] == 196
    assert sources.sources["wasde"].status == "live"
    # The pinned tag is used even though a newer one exists, and the lock is not rewritten.
    assert all("data-2026-11" not in c for c in host.calls)
    assert load_pin(settings.wasde_lock).release_tag == "data-2026-10"

    # Someone re-uploads different bytes under the same tag: rejected, the cache is kept.
    host.assets["data-2026-10"] = wasde_bytes["short"]
    sources = SourceLog()
    fetch_wasde(settings, sources, transport=httpx.MockTransport(host))
    assert path.read_bytes() == full
    status = sources.sources["wasde"]
    assert status.status == "cache" and "!= pin" in (status.detail or "")


def test_sha_mismatch_without_cache_raises(tmp_path, wasde_bytes):
    settings = _settings(tmp_path)
    write_pin(_pin("t", wasde_bytes["full"]), settings.wasde_lock)
    host = Tracker({"t": wasde_bytes["short"]}, latest="t")
    with pytest.raises(WasdeDataError, match="no cache"):
        fetch_wasde(settings, transport=httpx.MockTransport(host))


def test_update_pin_moves_to_the_latest_checked_release(tmp_path, wasde_bytes):
    full, short = wasde_bytes["full"], wasde_bytes["short"]
    settings = _settings(tmp_path)
    write_pin(_pin("old", short), settings.wasde_lock)
    host = Tracker({"old": short, "new": full}, latest="new")
    fetch_wasde(settings, transport=httpx.MockTransport(host))  # pinned: the short file
    fetch_wasde(settings, update_pin=True, transport=httpx.MockTransport(host))
    pin = load_pin(settings.wasde_lock)
    assert pin.release_tag == "new" and pin.sha256 == _sha(full) and pin.reports == 196

    # A "latest" release with fewer reports than the cache is a regression: keep the cache
    # and the pin.
    host.assets["newer"], host.latest = short, "newer"
    sources = SourceLog()
    fetch_wasde(settings, sources, update_pin=True, transport=httpx.MockTransport(host))
    assert load_pin(settings.wasde_lock).release_tag == "new"
    assert sources.sources["wasde"].status == "cache"
    assert (settings.bronze / "wasde_full.parquet").read_bytes() == full


def test_wasde_download_failure_falls_back_to_cache(tmp_path, wasde_bytes):
    full = wasde_bytes["full"]
    settings = _settings(tmp_path)
    write_pin(_pin("t", full), settings.wasde_lock)
    fetch_wasde(settings, transport=httpx.MockTransport(Tracker({"t": full}, latest="t")))
    sources = SourceLog()
    down = Tracker({}, latest="t", fail=True)
    fetch_wasde(settings, sources, transport=httpx.MockTransport(down))
    assert sources.sources["wasde"].status == "cache"
    assert "download failed" in (sources.sources["wasde"].detail or "")
    # Not a parquet file at all.
    garbage = Tracker({"t2": b"not parquet"}, latest="t2")
    sources = SourceLog()
    fetch_wasde(settings, sources, update_pin=True, transport=httpx.MockTransport(garbage))
    assert "unreadable parquet" in (sources.sources["wasde"].detail or "")


def _no_network(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"offline run touched the network: {request.url}")


def test_offline_never_touches_the_network(tmp_path, wasde_bytes):
    settings = _settings(tmp_path, offline=True)
    with pytest.raises(WasdeDataError, match="offline mode and no WASDE cache"):
        fetch_wasde(settings, transport=httpx.MockTransport(_no_network))
    settings.bronze.mkdir(parents=True, exist_ok=True)
    (settings.bronze / "wasde_full.parquet").write_bytes(wasde_bytes["full"])
    sources = SourceLog()
    fetch_wasde(settings, sources, transport=httpx.MockTransport(_no_network))
    assert sources.sources["wasde"].status == "offline"
    # The missing manifest is rebuilt from the cached file itself.
    manifest = json.loads((settings.bronze / "wasde_manifest.json").read_text())
    assert manifest["reports"] == 196 and manifest["latest_report"] == "2026-10"

    # A local file in offline mode skips the release meta as well.
    local = tmp_path / "local.parquet"
    local.write_bytes(wasde_bytes["short"])
    settings = replace(settings, wasde_local=str(local))
    fetch_wasde(settings, transport=httpx.MockTransport(_no_network))
    assert (settings.bronze / "wasde_full.parquet").read_bytes() == wasde_bytes["short"]


# ---------------------------------------------------------------- PTAX


def _ptax_rows(s: pd.Series) -> list[dict[str, str]]:
    return [{"data": d.strftime("%d/%m/%Y"), "valor": f"{v:.4f}"} for d, v in s.items()]


def _ptax_host(series: pd.Series, fail: bool = False):
    def handler(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(500)
        start = pd.to_datetime(request.url.params["dataInicial"], format="%d/%m/%Y")
        end = pd.to_datetime(request.url.params["dataFinal"], format="%d/%m/%Y")
        return httpx.Response(
            200, json=_ptax_rows(series[(series.index >= start) & (series.index <= end)])
        )

    return httpx.MockTransport(handler)


def test_ptax_problems_bounds_jumps_and_cache_end():
    s = fixtures.synthetic_ptax()
    assert ptax_problems(s, None) == []
    assert ptax_problems(s * 10, None) == ["rate outside 1.0-15.0 BRL/USD"]
    jump = s.copy()
    jump.iloc[100] *= 1.2
    assert ptax_problems(jump, None) == ["daily change of 15% or more"]
    assert ptax_problems(s.iloc[:-5], s) == ["ends before the cache"]
    assert ptax_problems(pd.Series(dtype="float64"), None) == ["no values"]


def test_ptax_fetch_validates_and_falls_back(tmp_path):
    s = fixtures.synthetic_ptax()
    s = s[s.index >= "2016-01-01"]
    sources = SourceLog()
    out = fetch_ptax(tmp_path, sources=sources, transport=_ptax_host(s))
    assert len(out) == len(s) and sources.sources["ptax"].status == "live"
    # A rescaled download (cents instead of reais) is rejected; so is an outage.
    for transport in (_ptax_host(s * 100), _ptax_host(s, fail=True)):
        sources = SourceLog()
        kept = fetch_ptax(tmp_path, sources=sources, transport=transport)
        assert kept.iloc[-1] == pytest.approx(s.iloc[-1], rel=1e-4)
        assert sources.sources["ptax"].status == "cache"
    with pytest.raises(FxDataError, match="no cache"):
        fetch_ptax(tmp_path / "empty", transport=_ptax_host(s, fail=True))
    with pytest.raises(FxDataError, match="offline mode and no PTAX cache"):
        fetch_ptax(tmp_path / "empty", offline=True, transport=httpx.MockTransport(_no_network))


# ---------------------------------------------------------------- CLI, settings and logging


def test_cli_offline_flag_does_not_leak_into_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("SOY_OFFLINE", raising=False)
    monkeypatch.setenv("SOY_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SOY_WEB_DATA_DIR", str(tmp_path / "web"))
    runner = CliRunner()
    res = runner.invoke(app, ["ingest", "--offline"])
    assert res.exit_code == InputDataError.exit_code == 3, res.output
    import os

    assert "SOY_OFFLINE" not in os.environ
    assert not Settings().offline


def test_cli_ingest_offline_on_fixtures(tmp_path, monkeypatch):
    import shutil

    from soyforecast.config import ROOT

    shutil.copytree(FIXTURES, tmp_path / "data" / "bronze")
    shutil.copytree(ROOT / "data" / "seed", tmp_path / "data" / "seed")
    monkeypatch.setenv("SOY_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SOY_WEB_DATA_DIR", str(tmp_path / "web"))
    res = CliRunner().invoke(app, ["--json-logs", "ingest", "--offline"])
    assert res.exit_code == 0, res.output


def test_cli_maps_contract_errors_to_exit_code_4(monkeypatch):
    from soyforecast import pipeline

    def broken(settings, **kw):
        raise ContractError("horizon 1: quantiles are not monotone")

    monkeypatch.setattr(pipeline, "run", broken)
    res = CliRunner().invoke(app, ["run", "--offline"])
    assert res.exit_code == 4


def test_stdlib_logs_are_routed_through_structlog(capsys):
    configure_logging("INFO", json=True)
    logging.getLogger("some.library").warning("library says %s", "hi")
    get_logger("soyforecast.test").info("ours", n=1)
    lines = [json.loads(x) for x in capsys.readouterr().err.strip().splitlines()]
    lib = next(x for x in lines if x["event"] == "library says hi")
    assert lib["level"] == "warning" and lib["logger"] == "some.library" and "timestamp" in lib
    assert any(x["event"] == "ours" and x["n"] == 1 for x in lines)
    configure_logging("INFO", json=False)
