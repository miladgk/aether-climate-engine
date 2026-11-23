WITH source AS (
    SELECT * FROM raw_telemetry
),

renamed_and_cast AS (
    SELECT
        CAST(time AS TIMESTAMP) AS observation_time,
        CAST(time AS DATE) AS observation_date,
        TRIM(location) AS station_name,
        LOWER(TRIM(period)) AS period,
        CAST(temperature_2m AS NUMERIC(5, 2)) AS temperature_c,
        ROUND((CAST(temperature_2m AS NUMERIC(5, 2)) * 9.0 / 5.0) + 32.0, 2) AS temperature_f,
        CAST(wind_speed_10m AS NUMERIC(5, 2)) AS wind_speed_kmh,
        ROUND(CAST(wind_speed_10m AS NUMERIC(5, 2)) / 3.6, 2) AS wind_speed_ms
    FROM source
    WHERE time IS NOT NULL
      AND temperature_2m IS NOT NULL
      AND wind_speed_10m IS NOT NULL
      AND location IS NOT NULL
),

deduplicated AS (
    SELECT DISTINCT
        observation_time,
        observation_date,
        station_name,
        period,
        temperature_c,
        temperature_f,
        wind_speed_kmh,
        wind_speed_ms
    FROM renamed_and_cast
)

SELECT * FROM deduplicated
