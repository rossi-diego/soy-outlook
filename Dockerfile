# Pipeline image: ingest -> silver -> gold -> backtest -> publish site JSON.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install .
# The package is installed non-editable, so point it at the project folders explicitly.
ENV SOY_DATA_DIR=/app/data \
    SOY_WEB_DATA_DIR=/app/web/public/data \n    SOY_WASDE_LOCK=/app/data/wasde.lock.json
ENTRYPOINT ["soyforecast"]
CMD ["--json-logs", "run"]
