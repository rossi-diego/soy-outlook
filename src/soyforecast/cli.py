"""Command line: `soyforecast run` builds everything and publishes the site data."""

from __future__ import annotations

from pathlib import Path

import typer

from soyforecast.config import Settings
from soyforecast.logs import configure_logging, get_logger

app = typer.Typer(
    add_completion=False, help="Point-in-time soybean price forecasts after each WASDE."
)
log = get_logger(__name__)


@app.callback()
def main(json_logs: bool = typer.Option(False, "--json-logs", help="JSON log lines (CI).")) -> None:
    configure_logging(Settings().log_level, json=json_logs)


@app.command()
def run(offline: bool = typer.Option(False, help="Use cached bronze files only.")) -> None:
    """Ingest, build features, backtest, forecast and write web/public/data/*.json."""
    import os

    if offline:
        os.environ["SOY_OFFLINE"] = "1"
    from soyforecast.pipeline import run as run_pipeline
    from soyforecast.publish.web_json import publish

    settings = Settings()
    artefacts = run_pipeline(settings)
    publish(artefacts, settings)


@app.command()
def ingest() -> None:
    """Refresh the bronze layer only (WASDE parquet, CBOT closes, PTAX)."""
    from soyforecast.pipeline import ingest as do_ingest

    do_ingest(Settings())


RAW_PREMIUM_OPTION = typer.Option(..., help="Private daily premium export (date, premium_c_bu).")


@app.command("derive-premium")
def derive_premium(
    raw: Path = RAW_PREMIUM_OPTION,
    offline: bool = typer.Option(True, help="Use cached bronze files only."),
) -> None:
    """Rebuild data/seed/paranagua_premium_monthly.{csv,meta.json} from a raw export.

    The raw file stays outside the repository; only the derived table and card are committed.
    """
    import os

    if offline:
        os.environ["SOY_OFFLINE"] = "1"
    from soyforecast.pipeline import derive_premium as do_derive

    do_derive(Settings(), raw)


def _github_output(**values: object) -> None:
    """Expose step outputs to GitHub Actions (no-op outside a workflow)."""
    import os

    target = os.getenv("GITHUB_OUTPUT")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as fh:
        for k, v in values.items():
            fh.write(f"{k}={str(v).lower() if isinstance(v, bool) else v}\n")


META_OPTION = typer.Option(Path("web/public/data/meta.json"), help="Published meta.json.")
DATA_OPTION = typer.Option(Path("web/public/data"), help="Freshly published data folder.")
BASELINE_OPTION = typer.Option(None, help="Previously published copy to diff against.")
FIXTURES_OPTION = typer.Option(Path("tests/fixtures/bronze"), help="Target bronze folder.")


@app.command()
def guard(
    event: str = typer.Option("close", help="'close' (after the CBOT close) or 'wasde'."),
    meta: Path = META_OPTION,
) -> None:
    """Decide whether a scheduled refresh should run now (writes should_run to GITHUB_OUTPUT)."""
    import json

    from soyforecast.freshness import cbot_closed_today, chicago_now, is_wasde_day

    if event == "close":
        should_run = cbot_closed_today()
    elif event == "wasde":
        next_release = None
        if meta.exists():
            next_release = json.loads(meta.read_text(encoding="utf-8")).get("next_wasde")
        should_run = is_wasde_day(next_release)
    else:
        raise typer.BadParameter("event must be 'close' or 'wasde'")
    log.info(
        "guard", trigger=event, chicago=chicago_now().isoformat(timespec="minutes"), run=should_run
    )
    _github_output(should_run=should_run)


@app.command()
def validate(
    data: Path = DATA_OPTION,
    baseline: Path | None = BASELINE_OPTION,
    allow_stale: bool = typer.Option(False, help="Report, but do not fail on, an old close."),
) -> None:
    """Validation gate: shape, freshness and row deltas. Exits 1 on any problem."""
    import os

    from soyforecast.publish.validate import summary_markdown
    from soyforecast.publish.validate import validate as run_validate
    from soyforecast.publish.web_json import SCHEMA_VERSION

    report = run_validate(data, SCHEMA_VERSION, baseline=baseline, require_fresh=not allow_stale)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(summary_markdown(report))
    _github_output(
        ok=report.ok,
        stale=report.stale,
        degraded=bool(report.degraded),
        degraded_sources=",".join(report.degraded),
        as_of_close=report.as_of_close or "",
    )
    if report.degraded:
        log.warning("validate.degraded", sources=report.degraded)
    if not report.ok:
        log.error("validate.failed", problems=report.problems)
        raise typer.Exit(1)
    log.info("validate.passed", as_of_close=report.as_of_close, bdays_old=report.bdays_old)


@app.command("make-fixtures")
def make_fixtures(
    out: Path = FIXTURES_OPTION,
) -> None:
    """Write the synthetic bronze inputs used by the hermetic CI run."""
    from soyforecast.fixtures import write_fixtures

    paths = write_fixtures(out)
    log.info("fixtures.written", files=[p.name for p in paths], path=str(out))


if __name__ == "__main__":
    app()
