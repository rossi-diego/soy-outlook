# Pipeline image: ingest -> silver -> gold -> backtest -> publish site JSON.
#
# Two stages: the builder resolves exactly the versions in uv.lock into a virtualenv; the runtime
# image gets only that virtualenv and runs as an unprivileged user. No data is baked in: data/
# (bronze cache, the WASDE pin and the derived premium table in data/seed) and web/public/data
# are mounted by docker-compose, so the premium table is never copied into an image layer.

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# Dependencies first (cached layer), then the package itself, non-editable.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" \
    XDG_CACHE_HOME=/tmp/cache
RUN groupadd --system --gid 10001 soy && useradd --system --uid 10001 --gid soy --home /app soy
WORKDIR /app
COPY --from=builder --chown=soy:soy /app/.venv /app/.venv
# The package is installed non-editable, so point it at the mounted project folders.
ENV SOY_DATA_DIR=/app/data \
    SOY_WEB_DATA_DIR=/app/web/public/data \
    SOY_WASDE_LOCK=/app/data/wasde.lock.json
USER soy
ENTRYPOINT ["soyforecast"]
CMD ["--json-logs", "run"]
