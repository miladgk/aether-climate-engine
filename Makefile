.PHONY: setup data-pipeline test lint format dbt-run dbt-test dashboard up down

setup:
	python3 -m venv venv
	./venv/bin/pip install -r requirements.txt
	./venv/bin/pre-commit install

data-pipeline:
	PYTHONPATH=. python3 src/etl/extract_load.py

test:
	pytest tests/ -v

lint:
	bandit -r src/
	ruff check src/
	sqlfluff lint dbt_telemetry/models

format:
	black src/
	isort src/

dbt-run:
	cd dbt_telemetry && dbt run

dbt-test:
	cd dbt_telemetry && dbt test

dashboard:
	python3 scripts/serve_dashboard.py

up:
	docker-compose up -d

down:
	docker-compose down
