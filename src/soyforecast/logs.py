"""Structured logging (structlog). JSON in CI, pretty console locally."""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def _stderr_logger(*_: Any) -> structlog.PrintLogger:
    return structlog.PrintLogger(file=sys.stderr)


def configure_logging(level: str = "INFO", json: bool = False) -> None:
    """Configure stdlib logging + structlog once per process."""
    logging.basicConfig(format="%(message)s", stream=sys.stderr, level=level.upper())
    processors: list[Any] = [
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
        processors=[*processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        logger_factory=_stderr_logger,
        # Not cached, and stderr is looked up per logger: the CLI may reconfigure (and tests
        # swap sys.stderr) within one process.
        cache_logger_on_first_use=False,
    )


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
