# Project Aether: Data Dictionary

Field-level definitions for every dataset Aether produces or models. Section 1 covers the active weather pipeline. Section 2 covers the separate clickstream models that live in `dbt_telemetry/`. They are **not** connected to the weather data.

## 1. Weather Telemetry (active pipeline)

### 1.1 `docs/sample_telemetry.json`: observed and historical readings
JSON Lines, one hourly reading per line, written by `src/etl/extract_load.py` and read by the dashboard.

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `time` | string (ISO-8601, no timezone) | — | Hour of the reading in the **station's local time** (requested with `timezone=auto`; the station's UTC offset is in `station_summary.json`). For `historical` rows this is the original timestamp **shifted forward 365 days**, so it lines up with the current timeline. |
| `temperature_2m` | number | °C | Air temperature 2 m above ground. |
| `wind_speed_10m` | number | km/h | Wind speed 10 m above ground. |
| `location` | string | — | Station name from `config.json`: `Berlin`, `Tokyo`, `New York`, `London`, `Sydney`. |
| `period` | string | — | `live`: an hour that has **already happened**, taken from the Open-Meteo forecast API's `past_days` output (Open-Meteo's best-estimate weather for past hours, not a raw station reading). Future hours are discarded. `historical`: from the archive API, used as the Year-over-Year baseline. The archive request covers `today − 372 d` → `today − 358 d` (15 calendar days, 360 hourly rows per station), which after the +365-day shift spans `today − 7 d` → `today + 7 d`. |

Quality rules applied before a row is written:
- **Schema contract** (`src/etl/validator.py`): `time` must be a string; `temperature_2m` and `wind_speed_10m` must be numeric. Hours where Open-Meteo returned `null` are dropped during parsing.
- **Anomaly filter** (`src/etl/anomaly_detector.py`): a `live` row is removed and sent to `dead_letter_queue.dlq` when its `temperature_2m` **or** its `wind_speed_10m` is more than `anomaly_sigma_threshold` (2.0) robust σ **and** more than a minimum deviation (`anomaly_min_deviation_c` = 2.5 °C for temperature, `anomaly_min_deviation_wind_kmh` = 12 km/h for wind; both doubled for the first/last 3 hours) away from a robust line fitted through the `anomaly_window_hours` (3) hours on either side. This catches sudden spikes and drops but keeps normal daily peaks, gusty wind, and gradual weather changes. It can occasionally flag the hour right at a very abrupt real change (the 2026-11-18 run flagged one London wind hour at a front). Drops of wind to near-calm are only caught when large, because a real calm hour looks the same. `historical` rows are not filtered.

**Observed window.** After filtering, only the latest `observed_window_hours` (96) clean `live` rows per station are written, ending at the station's current local hour. That window is exactly what the models are trained on and what the dashboard plots as "Observed". The chart always shows twice as many observed hours as forecast hours (96 + 48 by default), so it is two-thirds observed and one-third forecast. An hour dropped by the anomaly filter leaves a gap (the dashboard draws it as a break in the line). With the local spike filter this is rare: the 2026-11-18 snapshot has one gap (London, 2026-11-17 07:00 local, the wind hour flagged at a front), so London's 96 rows span 97 hours.

### 1.2 `docs/predictions.json`: model forecasts
JSON Lines, one forecast hour per station per model. Expected size: 5 stations × 3 methods × 48 hours = 720 rows.

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `time` | string (ISO-8601, station-local) | — | Forecast hour. Starts the hour after the station's last observed (`live`) row, i.e. right after "now". |
| `predicted_temperature_2m` | number | °C | Forecast temperature (trend + 24h cosine cycle peaking at 14:00 **station-local time** + decaying boundary residual). |
| `predicted_wind_speed_10m` | number | km/h | Forecast wind speed (same method, cycle peaking at 16:00 **station-local time**, clamped to ≥ 0). |
| `method` | string | — | `linear` (least-squares trend), `sma` (12-hour simple moving average), or `ema` (exponential moving average, α = 0.3). |
| `location` | string | — | Station name, as above. |

The dashboard's "Compare All" view, ensemble fan (min/max across the three methods), model spread, observation status tags and YoY delta badges are computed in the browser (`web/src/utils/telemetry.ts`) from these files and are not stored anywhere.

### 1.3 `docs/station_summary.json`: time zones and holdout MAE
One JSON object written on every pipeline run: `generated_at_utc` (when the snapshot was made; the dashboard header shows it with its age), plus `stations.<name>` with:

| Field | Definition |
| --- | --- |
| `utc_offset_seconds`, `timezone`, `timezone_abbreviation` | Station time zone as reported by Open-Meteo (`timezone=auto`). The pipeline uses the offset to cut the observed window at the station's current local hour. The dashboard uses `utc_offset_seconds` to convert every station-local timestamp to Central European Time for display, and `timezone` for each card's live local clock and day/night marker. |
| `observed_hours`, `observed_until` | How many observed rows were kept and the local time of the last one. Both are shown in the dashboard's station panel (`observed_until` converted to CET). |
| `latitude`, `longitude`, `elevation` | The Open-Meteo grid cell the request was snapped to and its elevation (m). Optional: snapshots written before 2026-11-19 lack them, and the dashboard then shows the coordinates from `config.json` with a fixed per-station elevation. |
| `holdout_hours` | Size of the backtest window (`config.json` → `holdout_hours`, default 24). |
| `holdout_mae.<linear\|sma\|ema>` | `temp_mae` (°C), `wind_mae` (km/h) and `n` (hours scored). Each model is trained on the observed window minus its last `holdout_hours`, then its forecast is compared with those observed hours. `n` < `holdout_hours` when the anomaly filter removed some of them. The dashboard's MAE cells, "★ Best in …" badge (lowest `temp_mae`) and holdout breakdown (which also shows `n`) come from here. |

### 1.4 PostgreSQL `raw_telemetry`
Best-effort copy of the rows in 1.1, batch-inserted by `src/infrastructure/postgres_connector.py`. Columns are `time`, `temperature_2m`, `wind_speed_10m`, `location`, `period`. All are created as **`TEXT`**, so cast them before doing numeric or time operations. There is no primary key and no de-duplication: each pipeline run appends a full copy of the current window.

### 1.5 `dead_letter_queue.dlq`
JSON Lines, append-only, git-ignored. Every line is `{"reason": ..., "record": {...}}`. `reason` is `"Schema Validation Failure"` or `"Anomaly: <metric(s)> spike"`, e.g. `"Anomaly: wind_speed_10m spike"` or `"Anomaly: temperature_2m + wind_speed_10m spike"`. (Before 2026-11-18, anomaly lines were the bare record with no `reason`.) See [`runbook.md`](runbook.md).

### Caveats
- **Freshness:** the public GitHub Pages site serves the last committed snapshot. Timestamps are the recorded ones, shown in Central European Time, and the header badge shows `generated_at_utc` and how old it is (amber after 26 h, red after 72 h).
- **Leap years:** the YoY baseline uses a fixed 365-day offset, so it is one calendar day off across a 29 February.
- **Daylight saving:** one UTC offset per station (the current one) is used to cut the observed window at the station's current hour. If a DST change falls inside the window, NOW can be off by an hour.

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
