WITH staging AS (
    SELECT * FROM {{ ref('stg_weather_telemetry') }}
),

daily_aggregates AS (
    SELECT
        station_name,
        observation_date,
        period,
        
        -- Sample volume
        COUNT(*) AS hourly_observations_count,
        
        -- Temperature aggregates (°C)
        ROUND(AVG(temperature_c), 2) AS avg_temperature_c,
        MIN(temperature_c) AS min_temperature_c,
        MAX(temperature_c) AS max_temperature_c,
        ROUND(MAX(temperature_c) - MIN(temperature_c), 2) AS diurnal_temperature_range_c,
        
        -- Temperature aggregates (°F)
        ROUND(AVG(temperature_f), 2) AS avg_temperature_f,
        MIN(temperature_f) AS min_temperature_f,
        MAX(temperature_f) AS max_temperature_f,
        
        -- Wind aggregates (km/h & m/s)
        ROUND(AVG(wind_speed_kmh), 2) AS avg_wind_speed_kmh,
        MAX(wind_speed_kmh) AS max_wind_speed_kmh,
        ROUND(AVG(wind_speed_ms), 2) AS avg_wind_speed_ms,
        MAX(wind_speed_ms) AS max_wind_speed_ms,
        
        -- Climate & hazard indicators
        SUM(CASE WHEN temperature_c <= 0.0 THEN 1 ELSE 0 END) AS freezing_hours_count,
        CASE 
            WHEN MIN(temperature_c) <= 0.0 THEN 1 
            ELSE 0 
        END AS is_freezing_day,
        SUM(CASE WHEN wind_speed_kmh >= 20.0 THEN 1 ELSE 0 END) AS elevated_wind_hours_count,
        SUM(CASE WHEN wind_speed_kmh >= 50.0 THEN 1 ELSE 0 END) AS gale_wind_hours_count

    FROM staging
    GROUP BY
        station_name,
        observation_date,
        period
)

SELECT * FROM daily_aggregates
