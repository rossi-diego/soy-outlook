.PHONY: install run test lint web e2e all

install:            ## Python package + dev tools, and the site's node modules
	pip install -e ".[dev]"
	cd web && npm ci

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
