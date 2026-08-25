WITH source AS (
    -- Reference the raw table populated by our ingestion script
    -- Hardcoding the table since it's raw ingestion, but could also be a {{ source() }} 
    SELECT * FROM raw_telemetry
),

renamed_and_cast AS (
    SELECT
        -- Assuming 'event_id' might come in as text, cast it to bigint
        CAST(event_id AS BIGINT) AS event_id,
        
        -- Clean strings and standardize naming
        LOWER(TRIM(event_type)) AS event_type,
        
        CAST(user_id AS BIGINT) AS user_id,
        
        -- Apply null coalescing for optional fields
        COALESCE(device_type, 'unknown') AS device_type,
        COALESCE(platform, 'unknown') AS platform,
        
        -- Cast strings to proper timestamps
        CAST(timestamp AS TIMESTAMP) AS event_timestamp,
        
        -- Extract any deeply nested extra metadata if present
        metadata

    FROM source
)

SELECT * FROM renamed_and_cast
