# Project Aether: Operations Runbook

How to run, troubleshoot, and recover the Aether weather-telemetry pipeline and dashboard.

## 1. Pipeline Overview

| Stage | What actually runs | Code |
| --- | --- | --- |
| Ingestion | Python `urllib.request` calls to the Open-Meteo **forecast** API (live, hourly) and **archive** API (a 15-day window one year earlier, `today − 372 d` → `today − 358 d`), for the 5 stations in `config.json`. Both requests use `timezone=auto`, so timestamps are station-local wall-clock time; the archive date range is computed from today's UTC date | `src/etl/extract_load.py` |
| Caching | Each API response is cached on disk in `/tmp/aether_cache/` (MD5 of the URL) for `cache_ttl_seconds` (1800s) | `src/etl/cache_manager.py` |
| Validation | Data contract: `time` (string), `temperature_2m` and `wind_speed_10m` (numeric) must be present | `src/etl/validator.py` |
| Anomaly filter | Local spike filter on **live temperature and wind**: flags an hour that is > `anomaly_sigma_threshold` (2.0) robust σ and more than `anomaly_min_deviation_c` (2.5 °C) / `anomaly_min_deviation_wind_kmh` (12 km/h) off a robust line through the ±`anomaly_window_hours` (3) neighbouring hours. A flag on either metric removes the whole hour. Historical records are not filtered | `src/etl/anomaly_detector.py` |
| Observed window | Forecast API called with `timezone=auto` and `past_days`; only hours up to the station's current local hour are kept, and after filtering, the latest `observed_window_hours` (96) | `src/etl/extract_load.py` |
| Forecasting | Linear, SMA, and EMA forecasts for `ml_prediction_hours` (48h) per station, trained on the observed window and starting the hour after "now". The daily cycle uses station-local hours | `src/ml/predictor.py` |
| Model scoring | Holdout MAE per model (train on the window minus its last `holdout_hours` (24), score those hours), written to `docs/station_summary.json` with each station's time zone | `src/ml/predictor.py` (`evaluate_holdout`) |
| Outputs | `docs/sample_telemetry.json` (clean live + historical records), `docs/predictions.json` (forecasts), both JSON Lines, and `docs/station_summary.json`; best-effort batch insert into PostgreSQL table `raw_telemetry` | `src/etl/extract_load.py`, `src/infrastructure/postgres_connector.py` |
| Orchestration | Airflow DAG `daily_telemetry_ingestion` (`@daily`, 3 retries, 5-minute delay, `catchup=False`). Defined but not deployed anywhere | `dags/daily_telemetry_ingestion.py` |
| Public site | GitHub Pages serves `docs/` as static files. It never runs the Python pipeline; the browser shifts the cached timestamps to the viewer's current hour | `.github/workflows/pages.yml`, `docs/index.html` |

Not part of the running pipeline:
- **AWS S3:** `src/infrastructure/s3_connector.py` exists but is never called.
- **dbt:** `dbt_telemetry/` models a user-clickstream schema, not weather data, so it cannot transform what the pipeline writes. See [`data_dictionary.md`](data_dictionary.md).

## 2. Routine Operations

### Refresh the data and run the dashboard locally
```bash
pip install -r requirements.txt
docker compose up -d postgres        # optional: without it, the DB step is skipped with a warning

PYTHONPATH=. python3 src/etl/extract_load.py
python3 scripts/serve_dashboard.py   # also re-runs the ETL on startup, then serves docs/ on http://localhost:8000
```
Both commands **overwrite `docs/sample_telemetry.json`, `docs/predictions.json` and `docs/station_summary.json`** in your working tree.

Nothing in the code loads a `.env` file (there is no `python-dotenv`). Database settings come from exported `POSTGRES_*` environment variables, or from the code defaults when none are set (see "PostgreSQL connection problems" below).

### Update the public dashboard data
The public site only changes when those files are committed and pushed. Any push to `main` that touches `docs/**` triggers the "Deploy Aether dashboard" workflow. Before you commit regenerated data, check the record counts:
```bash
wc -l docs/sample_telemetry.json docs/predictions.json   # predictions should be 5 stations × 3 methods × 48h = 720
```
Commit all three files together: the dashboard uses `station_summary.json` for time zones and the MAE ranking, so mixing files from different runs mislabels the chart. If you change `observed_window_hours`, the chart still shows `2 × horizon` observed hours, so keep it ≥ 96 for the 48h view.

## 3. Failure Modes & Troubleshooting

### The ETL says "success", but data is missing or stale
The pipeline is deliberately forgiving. It reports `status: success` even when:
- **An Open-Meteo request fails** (network error, HTTP 429, timeout). The error is logged as `Error fetching live/historical data for <station>`, and that station is simply missing from the output.
- **PostgreSQL is unreachable.** The log shows `Skipping Postgres bulk insert due to unavailable container`, and only the JSON files are updated.

**Response steps:**
1. Search the run's log for `Error fetching` and `Skipping Postgres`.
2. Check how many records each station got: `grep -c '"location": "Berlin"' docs/sample_telemetry.json` (repeat per station).
3. If the API was rate-limited, wait and re-run. Responses that already succeeded come from cache for 30 minutes, so a re-run only re-requests what failed.
4. To force fresh data, clear the cache: `rm -rf /tmp/aether_cache`.

### The ETL returns `status: failed`
The pipeline only returns `failed` if something raises while it is writing outputs, for example `docs/` is not writable or a record is malformed while sorting. Read the `Ingestion failed for <date>: <error>` log line. When this happens under Airflow, the wrapper raises, so the task retries 3 times before the DAG run fails.

### Records in the Dead Letter Queue
`dead_letter_queue.dlq` (repo root, git-ignored, append-only) holds two kinds of lines:
- **Schema failures:** `{"reason": "Schema Validation Failure", "record": {...}}`. Usually an upstream API format change; check the Open-Meteo response.
- **Anomalies:** `{"reason": "Anomaly: <metric(s)> spike", "record": {...}}`, a live hour whose temperature and/or wind jumped away from its neighbouring hours (see the filter row in §1). Most are sensor or data faults, but a very sharp real change (e.g. a thunderstorm outflow, sea-breeze or wind front) can also be flagged. Review them before changing `anomaly_sigma_threshold`, `anomaly_window_hours`, `anomaly_min_deviation_c` or `anomaly_min_deviation_wind_kmh`. Lines written before 2026-11-18 are bare records with no `reason`.

The file is never rotated. Truncate it manually once it has been reviewed.

### PostgreSQL connection problems
- The connection string is built from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`. Code defaults (`aether_user` / `aether_password` / `aether_warehouse` on `localhost:5432`) match `docker-compose.yml`.
- **Watch out:** `.env.example` uses different values (`POSTGRES_USER=postgres`, `POSTGRES_DB=telemetry_db`). If you copy it to `.env` and export it, the pipeline won't match the Docker Compose database. Either edit `.env` to the Compose values or skip it.
- Every column of `raw_telemetry` is created as `TEXT`. Cast `temperature_2m` / `wind_speed_10m` when querying.

### Airflow DAG failure (`daily_telemetry_ingestion`)
Airflow is not installed or deployed in this project. This applies only if you run the DAG yourself.
1. Open the logs for the `ingest_telemetry_data` task.
2. Look for the `Ingestion failed:` exception raised by the wrapper and handle it as described under "The ETL returns `status: failed`" above.
3. To retry, clear the failed task instance in the Airflow UI.

### dbt failures
`dbt debug` and `dbt deps` run in CI and pass. `dbt run` / `dbt test` against a `raw_telemetry` table filled by this pipeline **will fail**, because the staging model selects clickstream columns (`event_id`, `user_id`, `device_type`, …) that the weather table doesn't have. This is a known design gap, not an incident.

## 4. Backfills

**There is currently no working backfill.** `run_daily_ingestion(execution_date)` (and `--date` on the CLI) only uses the date for logging. The live window is always "now" from the forecast API, and the historical window is always computed from today's UTC date. So `airflow dags backfill daily_telemetry_ingestion --start-date … --end-date …` would just re-fetch today's data once per date.

A real backfill would need `extract_load.py` to derive the archive (and live) date range from `execution_date`. Until then, the only way to recover a missed day is to re-run the pipeline on a later day. That gives you the current window, not the missed one.
