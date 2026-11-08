.PHONY: install lock run test lint web e2e all ci-offline validate fixtures

install:            ## Locked Python env (uv.lock) + dev tools, and the site's node modules
	uv sync --locked --extra dev
	cd web && npm ci

lock:               ## Re-resolve uv.lock after a change to pyproject.toml dependencies
	uv lock

run:                ## Ingest, backtest, forecast, write web/public/data
	soyforecast run

test:
	pytest --cov --cov-report=term-missing

lint:
	ruff format --check src tests
	ruff check src tests
	mypy src
	cd web && npm run lint && npm run typecheck

web:                ## Static site in web/out
	cd web && npm run build

e2e: web
	cd web && npx playwright test

all: run test web

ci-offline:         ## What ci.yml does: offline run on the synthetic fixtures into .ci/, then the gate
	rm -rf .ci && mkdir -p .ci/data && cp -r tests/fixtures/bronze .ci/data/bronze && cp -r data/seed .ci/data/seed
	SOY_DATA_DIR=.ci/data SOY_WEB_DATA_DIR=.ci/web-data soyforecast run --offline
	soyforecast validate --data .ci/web-data --allow-stale

validate:           ## Validation gate on the committed site data
	soyforecast validate --data web/public/data --allow-stale

fixtures:           ## Regenerate tests/fixtures/bronze from the fixed seeds
	soyforecast make-fixtures
