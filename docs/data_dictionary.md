# Project Aether: Data Dictionary

Field-level definitions for every dataset Aether produces or models. Section 1 covers the active weather pipeline. Section 2 covers the separate clickstream models that live in `dbt_telemetry/`. They are **not** connected to the weather data.

## 1. Weather Telemetry (active pipeline)

### 1.1 `docs/sample_telemetry.json`: observed and historical readings
JSON Lines, one hourly reading per line, written by `src/etl/extract_load.py` and read by the dashboard.

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `time` | string (ISO-8601, no timezone) | — | Hour of the reading in **UTC/GMT** (Open-Meteo's default; the pipeline does not send a `timezone` parameter). For `historical` rows this is the original timestamp **shifted forward 365 days**, so it lines up with the current timeline. |
| `temperature_2m` | number | °C | Air temperature 2 m above ground. |
| `wind_speed_10m` | number | km/h | Wind speed 10 m above ground. |
| `location` | string | — | Station name from `config.json`: `Berlin`, `Tokyo`, `New York`, `London`, `Sydney`. |
| `period` | string | — | `live`: from the Open-Meteo **forecast** API, which returns 7 days of hourly values starting at 00:00 today. That mixes today's elapsed hours with Open-Meteo's own forecast for the coming days, so a `live` row is not necessarily a measured observation. `historical`: from the archive API, used as the Year-over-Year baseline. The archive request covers `today − 372 d` → `today − 358 d` (15 calendar days, 360 hourly rows per station), which after the +365-day shift spans `today − 7 d` → `today + 7 d`. |

Quality rules applied before a row is written:
- **Schema contract** (`src/etl/validator.py`): `time` must be a string; `temperature_2m` and `wind_speed_10m` must be numeric. Hours where Open-Meteo returned `null` are dropped during parsing.
- **Anomaly filter** (`src/etl/anomaly_detector.py`): `live` rows whose `temperature_2m` is outside ±2.0σ of that station's window mean are removed and sent to `dead_letter_queue.dlq`. Wind speed is not filtered, and neither are `historical` rows.

**Only the first 72 `live` rows per station are used.** The forecaster trains on `records[:72]` (`src/ml/predictor.py`), and the dashboard shows the same `.slice(0, 72)` as its "Observed" series (`docs/index.html`). The remaining ~80–95 `live` rows per station are written to the file but not displayed or modelled. Because the forecast API starts at 00:00 UTC today, those 72 rows run from 00:00 today to 23:00 two days later, so most of the "Observed" curve near the NOW line is Open-Meteo's own forecast, not a measurement.

### 1.2 `docs/predictions.json`: model forecasts
JSON Lines, one forecast hour per station per model. Expected size: 5 stations × 3 methods × 48 hours = 720 rows.

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `time` | string (ISO-8601, UTC) | — | Forecast hour. Starts the hour after the station's **72nd** clean `live` row (the end of the training window), not after its last `live` row. |
| `predicted_temperature_2m` | number | °C | Forecast temperature (trend + 24h cosine cycle peaking at 14:00 **UTC** + decaying boundary residual). |
| `predicted_wind_speed_10m` | number | km/h | Forecast wind speed (same method, cycle peaking at 16:00 **UTC**, clamped to ≥ 0). |
| `method` | string | — | `linear` (least-squares trend), `sma` (12-hour simple moving average), or `ema` (exponential moving average, α = 0.3). |
| `location` | string | — | Station name, as above. |

The dashboard's "Compare All" view, ensemble fan (min/max across the three methods), and YoY delta badges are computed in the browser from these two files and are not stored anywhere. The **holdout MAE** values and the winning-model badge are different: they come from a hard-coded `STATION_META` table in `docs/index.html`, not from these files. No code in the repository produces or re-checks those MAE numbers, so they do not change when the data is regenerated.

### 1.3 PostgreSQL `raw_telemetry`
Best-effort copy of the rows in 1.1, batch-inserted by `src/infrastructure/postgres_connector.py`. Columns are `time`, `temperature_2m`, `wind_speed_10m`, `location`, `period`. All are created as **`TEXT`**, so cast them before doing numeric or time operations. There is no primary key and no de-duplication: each pipeline run appends a full copy of the current window.

### 1.4 `dead_letter_queue.dlq`
JSON Lines, append-only, git-ignored. Holds either `{"reason": "Schema Validation Failure", "record": {...}}` or a raw anomalous `live` record (no `reason` field). See [`runbook.md`](runbook.md).

### Caveats
- **Freshness:** the public GitHub Pages site serves the last committed snapshot. The browser shifts all timestamps so the newest reading lines up with the viewer's current hour, which means displayed times are not the original observation times.
- **Committed snapshot age:** the files in `docs/` were last committed 2026-11-10 (`ec73769`); their `live` rows start 2026-11-09 00:00 UTC. Each station's forecasts start right after its 72nd clean `live` row (Berlin: 2026-11-12 00:00 → 2026-11-13 23:00), which is what a single pipeline run produces. The two files are consistent with each other.
- **Leap years:** the YoY baseline uses a fixed 365-day offset, so it is one calendar day off across a 29 February.
- **Station time zones:** timestamps stay in UTC and are never converted to station-local time. The forecast's diurnal cycle is therefore phased to 14:00/16:00 **UTC** for every station. That is roughly right for Berlin and London, but the snapshot's own historical data peaks around 04:00 UTC in Tokyo, 02:00 UTC in Sydney and 19:00 UTC in New York.

## 2. Clickstream Models (`dbt_telemetry/`, not connected)

These dbt models describe a **user-clickstream** schema. They were not built for the weather data above, and nothing in the repository produces a `raw_telemetry` table in this shape. Running `dbt run` against the weather `raw_telemetry` table fails on missing columns.

### 2.1 `stg_raw_telemetry` (view)
| Column | Type | Definition |
| --- | --- | --- |
| `event_id` | BIGINT | Event identifier. dbt tests: `unique`, `not_null`. |
| `event_type` | VARCHAR | Lower-cased, trimmed action name. dbt test: `accepted_values` = `click`, `login`, `purchase`, `view`, `logout`. |
| `user_id` | BIGINT | User identifier (PII). |
| `device_type` | VARCHAR | Device category; `unknown` if null. |
| `platform` | VARCHAR | Software platform; `unknown` if null. |
| `event_timestamp` | TIMESTAMP | Cast from the raw `timestamp` column. |
| `metadata` | (raw) | Passed through unchanged. |

### 2.2 `fct_user_events` (table)
All `stg_raw_telemetry` columns except `metadata`, joined to a **hard-coded two-row mock user dimension** (user IDs 123 and 456), plus:

| Column | Definition |
| --- | --- |
| `user_subscription_tier` | `Premium` / `Free` from the mock dimension; `Unknown` if the user is not in it. |
| `user_country` | `US` / `UK` from the mock dimension; `Unknown` if the user is not in it. |
| `event_hour` | `DATE_TRUNC('hour', event_timestamp)`. |
| `is_session_start` | `1` when `event_type = 'login'`, else `0`. |

No session-duration metric is implemented.

### 2.3 Root `sample_telemetry.json` (synthetic)
5,000 synthetic clickstream events from `scripts/generate_mock_data.py`, with fields `event_id` (UUID string), `user.id`, `user.ip_address`, `event_type`, `timestamp`, and `metadata.browser` / `metadata.duration_ms`. **It does not fit the dbt staging model either:**
- `event_id` is a UUID, not a BIGINT.
- The user ID is nested under `user.id`.
- `device_type` and `platform` are missing.
- Its event types (`page_view`, `checkout`, `error`) fall outside the `accepted_values` list.

`src/etl/utils.py` has PII-hashing and JSON-flattening helpers written for this shape. Flattening is used by the weather pipeline; PII hashing is not.
