# Project Aether: Data Dictionary

Field-level definitions for every dataset Aether produces or models. Section 1 covers the active weather pipeline data feeds. Section 2 covers the warehouse transformation and dimensional analytics models in `dbt_telemetry/`.

## 1. Weather Telemetry (active pipeline)

### 1.1 `docs/sample_telemetry.json`: observed and historical readings
JSON Lines, one hourly reading per line, written by `src/etl/extract_load.py` and read by the dashboard.

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `time` | string (ISO-8601, no timezone) | — | Hour of the reading in the **station's local time** (requested with `timezone=auto`; the station's UTC offset is in `station_summary.json`). For `historical` rows this is the original timestamp **shifted forward 365 days**, so it lines up with the current timeline. |
| `temperature_2m` | number | °C | Air temperature 2 m above ground. |
| `wind_speed_10m` | number | km/h | Wind speed 10 m above ground. |
| `location` | string | — | Station name from `config.json`: `Berlin`, `Tokyo`, `New York`, `London`, `Sydney`, `Helsinki`. |
| `period` | string | — | `live`: an hour that has **already happened**, taken from the Open-Meteo forecast API's `past_days` output (Open-Meteo's best-estimate weather for past hours, not a raw station reading). Future hours are discarded. `historical`: from the archive API, used as the Year-over-Year baseline. The archive request covers `today − 372 d` → `today − 358 d` (15 calendar days, 360 hourly rows per station), which after the +365-day shift spans `today − 7 d` → `today + 7 d`. |

Quality rules applied before a row is written:
- **Schema contract** (`src/etl/validator.py`): `time` must be a string; `temperature_2m` and `wind_speed_10m` must be numeric. Hours where Open-Meteo returned `null` are dropped during parsing.
- **Anomaly filter** (`src/etl/anomaly_detector.py`): a `live` row is removed and sent to `dead_letter_queue.dlq` when its `temperature_2m` **or** its `wind_speed_10m` is more than `anomaly_sigma_threshold` (2.0) robust σ **and** more than a minimum deviation (`anomaly_min_deviation_c` = 2.5 °C for temperature, `anomaly_min_deviation_wind_kmh` = 12 km/h for wind; both doubled for the first/last 3 hours) away from a robust line fitted through the `anomaly_window_hours` (3) hours on either side. This catches sudden spikes and drops but keeps normal daily peaks, gusty wind, and gradual weather changes. It can occasionally flag the hour right at a very abrupt real change (the 2026-11-18 run flagged one London wind hour at a front). Drops of wind to near-calm are only caught when large, because a real calm hour looks the same. `historical` rows are not filtered.

**Observed window.** After filtering, only the latest `observed_window_hours` (96) clean `live` rows per station are written, ending at the station's current local hour. That window is exactly what the models are trained on and what the dashboard plots as "Observed". The chart always shows twice as many observed hours as forecast hours (96 + 48 by default), so it is two-thirds observed and one-third forecast. An hour dropped by the anomaly filter leaves a gap (the dashboard draws it as a break in the line). With the local spike filter this is rare: the 2026-11-18 snapshot has one gap (London, 2026-11-17 07:00 local, the wind hour flagged at a front), so London's 96 rows span 97 hours.

### 1.2 `docs/predictions.json`: model forecasts
JSON Lines, one forecast hour per station per model. Expected size: 6 stations × 3 methods × 48 hours = 864 rows.

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

### 1.6 `docs/live_latest.json`: hourly real-time telemetry stream
A single JSON document generated hourly at off-peak minute `17 * * * *` by `scripts/fetch_live_readings.py`. Deployed directly to GitHub Pages as part of the two-speed architecture without committing to git history (`docs/live_latest.json` is git-ignored). Contains the latest near-surface temperature and 10 m wind speed for all 6 stations directly from Open-Meteo's `current` endpoint:

| Field | Type | Unit | Definition |
| --- | --- | --- | --- |
| `generated_at_utc` | string (ISO-8601, UTC) | — | Pipeline generation timestamp. |
| `readings.<Station>.temperature_2m` | number | °C | Current near-surface air temperature. |
| `readings.<Station>.wind_speed_10m` | number | km/h | Current surface wind speed. |
| `readings.<Station>.time` | string (ISO-8601) | — | Station-local reading timestamp. |
| `readings.<Station>.timezone` | string | — | Station IANA time zone (e.g. `Europe/Berlin`, `Europe/Helsinki`). |
| `readings.<Station>.utc_offset_seconds` | integer | s | UTC offset in seconds. |
| `readings.<Station>.latitude`, `longitude`, `elevation` | number | — | Model grid coordinates and elevation. |

### Caveats
- **Freshness & Two-Speed Architecture:** The public dashboard employs a two-speed architecture: precomputed ML forecasts and 96-hour history are refreshed daily at 05:17 UTC (`station_summary.json`), while live telemetry readings are refreshed hourly at minute 17 (`live_latest.json`). The header badge displays the latest dataset snapshot timestamp in Central European Time with its relative age (amber after 26 h, red after 72 h).
- **Leap years:** the YoY baseline uses a fixed 365-day offset, so it is one calendar day off across a 29 February.
- **Daylight saving:** one UTC offset per station (the current one) is used to cut the observed window at the station's current hour. If a DST change falls inside the window, NOW can be off by an hour.

## 2. Dimensional Analytics Models (`dbt_telemetry/`)

These dbt models transform the raw landing table (`raw_telemetry`) populated by the ingestion pipeline into analytics-ready staging views and daily climate metric fact tables.

### 2.1 `stg_weather_telemetry` (view)
Cleanses, deduplicates, and types incoming hourly telemetry into structured numeric and timestamp fields.

| Column | Type | Unit | Definition |
| --- | --- | --- | --- |
| `observation_time` | TIMESTAMP | — | Exact observation timestamp in station-local time. dbt test: `not_null`. |
| `observation_date` | DATE | — | Truncated date of the observation. dbt test: `not_null`. |
| `station_name` | VARCHAR | — | Monitoring station name (`Berlin`, `Tokyo`, `New York`, `London`, `Sydney`, `Helsinki`). dbt tests: `not_null`, `accepted_values`. |
| `period` | VARCHAR | — | Observation stream category (`live` or `historical`). dbt tests: `not_null`, `accepted_values`. |
| `temperature_c` | NUMERIC(5,2) | °C | Air temperature at 2 m above ground. dbt test: `not_null`. |
| `temperature_f` | NUMERIC(5,2) | °F | Air temperature converted to Fahrenheit: `(temp * 9/5) + 32`. dbt test: `not_null`. |
| `wind_speed_kmh` | NUMERIC(5,2) | km/h | Wind speed at 10 m above ground. dbt test: `not_null`. |
| `wind_speed_ms` | NUMERIC(5,2) | m/s | Wind speed converted to meters per second: `wind / 3.6`. dbt test: `not_null`. |

### 2.2 `fct_daily_station_metrics` (table)
Aggregates hourly telemetry into a daily climate intelligence fact table partitioned by station, date, and period.

| Column | Type | Unit | Definition |
| --- | --- | --- | --- |
| `station_name` | VARCHAR | — | Station name. dbt test: `not_null`. |
| `observation_date` | DATE | — | Calendar date of summary. dbt test: `not_null`. |
| `period` | VARCHAR | — | `live` or `historical` stream. dbt test: `not_null`. |
| `hourly_observations_count` | BIGINT | — | Number of valid hourly readings recorded during the day. dbt test: `not_null`. |
| `avg_temperature_c` | NUMERIC | °C | Mean daily temperature. |
| `min_temperature_c` | NUMERIC | °C | Minimum recorded daily temperature. |
| `max_temperature_c` | NUMERIC | °C | Maximum recorded daily temperature. |
| `diurnal_temperature_range_c` | NUMERIC | °C | Daily diurnal thermal range: `max_temp - min_temp`. |
| `avg_temperature_f` | NUMERIC | °F | Mean daily temperature in Fahrenheit. |
| `min_temperature_f` | NUMERIC | °F | Minimum daily temperature in Fahrenheit. |
| `max_temperature_f` | NUMERIC | °F | Maximum daily temperature in Fahrenheit. |
| `avg_wind_speed_kmh` | NUMERIC | km/h | Mean daily wind speed in km/h. |
| `max_wind_speed_kmh` | NUMERIC | km/h | Peak wind speed recorded during the day. |
| `avg_wind_speed_ms` | NUMERIC | m/s | Mean daily wind speed in m/s. |
| `max_wind_speed_ms` | NUMERIC | m/s | Peak wind speed in m/s. |
| `freezing_hours_count` | BIGINT | hours | Count of hours with temperatures $\le 0$ °C. |
| `is_freezing_day` | INTEGER | flag | Binary indicator (1/0) of whether any freezing occurred during the day. |
| `elevated_wind_hours_count` | BIGINT | hours | Count of hours with wind speeds $\ge 20$ km/h (Beaufort 4+). |
| `gale_wind_hours_count` | BIGINT | hours | Count of hours with gale-force winds $\ge 50$ km/h. |


