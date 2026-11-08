"""P25: the pydantic site contract, its exported JSON Schema and the gated, atomic publish."""

from __future__ import annotations

import json
import shutil
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from soyforecast.config import ROOT
from soyforecast.errors import ContractError
from soyforecast.publish import schema
from soyforecast.publish.web_json import build_payloads, publish

SCHEMA_DIR = ROOT / "web" / "lib" / "schema"
NOW = datetime(2026, 11, 6, 21, tzinfo=UTC)


def test_schema_version_matches_the_model():
    assert get_args(schema.Meta.model_fields["schema_version"].annotation) == (
        schema.SCHEMA_VERSION,
    )


def test_exported_json_schema_is_up_to_date(tmp_path):
    """web/lib/schema must be what `soyforecast export-schema` writes today (CI freshness)."""
    for path in schema.export_schemas(tmp_path):
        committed = SCHEMA_DIR / path.name
        assert committed.exists(), f"{path.name} not exported: run `soyforecast export-schema`"
        assert json.loads(committed.read_text(encoding="utf-8")) == json.loads(
            path.read_text(encoding="utf-8")
        ), f"{path.name} is stale: run `soyforecast export-schema` and `npm run gen:types`"


def test_published_files_validate_and_round_trip(published):
    for name in schema.FILES:
        raw = json.loads((published / name).read_text(encoding="utf-8"))
        assert schema.dump(schema.validate_payload(name, raw)) == raw


def test_models_reject_unknown_keys_nulls_nan_and_bad_quantiles(published):
    outlook = json.loads((published / "outlook.json").read_text(encoding="utf-8"))
    cases = []
    extra = json.loads(json.dumps(outlook))
    extra["horizons"][0]["surprise"] = 1
    cases.append((extra, "Extra inputs are not permitted"))
    null = json.loads(json.dumps(outlook))
    null["horizons"][2]["q975"] = None
    cases.append((null, "valid number"))
    swapped = json.loads(json.dumps(outlook))
    swapped["horizons"][1]["q100"], swapped["horizons"][1]["q900"] = (
        swapped["horizons"][1]["q900"],
        swapped["horizons"][1]["q100"],
    )
    cases.append((swapped, "not monotone"))
    missing = json.loads(json.dumps(outlook))
    missing["horizons"] = missing["horizons"][:2]
    cases.append((missing, "outlook horizons"))
    for payload, message in cases:
        with pytest.raises(ValidationError, match=message):
            schema.validate_payload("outlook.json", payload)
    with pytest.raises(ValidationError):
        schema.Outlook.model_validate({**outlook, "last": {"date": "2026-11-06", "c_bu": "nan"}})
    meta = json.loads((published / "meta.json").read_text(encoding="utf-8"))
    with pytest.raises(ValidationError, match="schema_version"):
        schema.validate_payload("meta.json", {**meta, "schema_version": schema.SCHEMA_VERSION + 1})


def test_contract_violation_raises_before_anything_is_written(fixture_run, tmp_path):
    artefacts, settings = fixture_run
    out = tmp_path / "web"
    bad = replace(artefacts, forecast=[dict(r, q900=r["q025"] - 1) for r in artefacts.forecast])
    with pytest.raises(ContractError, match="not monotone"):
        publish(bad, replace(settings, web_data_dir=out), now=NOW)
    assert not out.exists() or not any(out.iterdir())
    assert not list(tmp_path.glob(".web.staging-*"))


def test_publish_swaps_in_a_complete_folder_and_keeps_the_archive(fixture_run, tmp_path):
    artefacts, settings = fixture_run
    s = replace(settings, web_data_dir=tmp_path / "web")
    publish(artefacts, s, now=NOW)
    first = {p.name: p.read_bytes() for p in (tmp_path / "web").rglob("*.json")}
    assert "run_manifest.json" in first and "2026-11-06.json" in first
    (tmp_path / "web" / "extra.txt").write_text("kept", encoding="utf-8")
    publish(artefacts, s, now=NOW)
    assert (tmp_path / "web" / "extra.txt").read_text(encoding="utf-8") == "kept"
    assert (tmp_path / "web" / "archive" / "2026-11-06.json").read_bytes() == first[
        "2026-11-06.json"
    ]
    # No staging or backup folder is left behind.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["web"]


def test_publish_refuses_to_go_backwards(fixture_run, tmp_path):
    artefacts, settings = fixture_run
    s = replace(settings, web_data_dir=tmp_path / "web")
    publish(artefacts, s, now=NOW)
    meta_path = tmp_path / "web" / "meta.json"
    newer = json.loads(meta_path.read_text(encoding="utf-8"))
    newer["as_of_close"] = "2026-11-20"
    meta_path.write_text(json.dumps(newer), encoding="utf-8")
    with pytest.raises(ContractError, match="as_of_close went backwards"):
        publish(artefacts, s, now=NOW)
    # The live copy is untouched by the failed publish.
    assert json.loads(meta_path.read_text(encoding="utf-8"))["as_of_close"] == "2026-11-20"


def test_build_payloads_are_validated_models(fixture_run):
    artefacts, settings = fixture_run
    payloads = build_payloads(artefacts, settings, NOW)
    assert set(payloads) == set(schema.FILES) - {"archive/index.json"}
    assert payloads["meta.json"]["schema_version"] == schema.SCHEMA_VERSION
    split = payloads["wasde.json"]["reaction"]["robustness"]["split_sample"]
    assert "break" in split and "break_" not in split  # published under the alias
    assert set(payloads["outlook.json"]["horizons"][0]["coverage"]["nominal"]) == {"80", "95"}


def test_export_schema_cli(tmp_path):
    from typer.testing import CliRunner

    from soyforecast.cli import app

    res = CliRunner().invoke(app, ["export-schema", "--out", str(tmp_path)])
    assert res.exit_code == 0, res.output
    site = json.loads((tmp_path / "site.schema.json").read_text(encoding="utf-8"))
    assert {"Meta", "Outlook", "Horizon", "TrackRecord", "Wasde"} <= set(site["$defs"])
    assert Path(tmp_path / "archive_index.schema.json").exists()
    shutil.rmtree(tmp_path)


def test_track_record_paths_and_archive_reject_crossed_ranges(published):
    tr = json.loads((published / "track_record.json").read_text(encoding="utf-8"))
    row = tr["paths"]["1"]["rw"][0]
    row["q10"], row["q90"] = row["q90"] + 1, row["q10"]
    with pytest.raises(ValidationError, match="not monotone"):
        schema.validate_payload("track_record.json", tr)
    idx = json.loads((published / "archive" / "index.json").read_text(encoding="utf-8"))
    hz = idx["entries"][0]["horizons"][0]
    hz["low80"] = hz["high95"] + 1
    with pytest.raises(ValidationError, match="not nested"):
        schema.validate_payload("archive/index.json", idx)
