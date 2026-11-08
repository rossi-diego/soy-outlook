"""Structured logging (structlog). JSON in CI, pretty console locally.

Library logs that go through the standard `logging` module (httpx, yfinance, ...) are routed
through the same structlog processors, so a CI run emits one consistent JSON stream.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_HANDLER_NAME = "soyforecast"


def _stderr_logger(*_: Any) -> structlog.PrintLogger:
    return structlog.PrintLogger(file=sys.stderr)


class _StderrHandler(logging.StreamHandler):
    """Looks up sys.stderr on every record (tests and the CLI runner swap it)."""

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stderr
        super().emit(record)


def configure_logging(level: str = "INFO", json: bool = False) -> None:
    """Configure structlog and route stdlib logging through the same renderer."""
    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    renderer: Any = (
        structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[*shared, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        logger_factory=_stderr_logger,
        # Not cached, and stderr is looked up per logger: the CLI may reconfigure (and tests
        # swap sys.stderr) within one process.
        cache_logger_on_first_use=False,
    )
    handler = _StderrHandler()
    handler.set_name(_HANDLER_NAME)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=[structlog.stdlib.add_logger_name, *shared],
            processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, renderer],
        )
    )
    root = logging.getLogger()
    root.handlers = [h for h in root.handlers if h.get_name() != _HANDLER_NAME] + [handler]
    root.setLevel(level.upper())
    # httpx logs every request at INFO; keep those at WARNING unless debugging.
    if level.upper() != "DEBUG":
        logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
