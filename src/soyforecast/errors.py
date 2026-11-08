"""Errors the CLI maps to process exit codes (P24).

0  success
1  the validation gate found a problem (`soyforecast validate`)
2  bad command line (typer's usage errors)
3  an input could not be obtained: offline with no cache, or a download rejected with no
   cache to fall back to
4  the published data broke its contract (schema, monotone quantiles, a regression
   against the previous publish); nothing was written
"""

from __future__ import annotations


class SoyError(RuntimeError):
    exit_code = 1


class InputDataError(SoyError):
    """An input source is unavailable and there is no acceptable cache."""

    exit_code = 3


class ContractError(SoyError):
    """The data about to be published does not satisfy the site contract."""

    exit_code = 4
