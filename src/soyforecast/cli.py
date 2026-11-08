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


if __name__ == "__main__":
    app()
