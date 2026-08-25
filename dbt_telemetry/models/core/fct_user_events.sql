WITH staging_events AS (
    SELECT * FROM {{ ref('stg_raw_telemetry') }}
),

-- Mock user dimension for demonstration purposes. 
-- In a real scenario, this would be {{ ref('dim_users') }}
dim_users AS (
    SELECT 
        123 AS user_id, 
        'Premium' AS subscription_tier, 
        'US' AS country
    UNION ALL
    SELECT 
        456 AS user_id, 
        'Free' AS subscription_tier, 
        'UK' AS country
),

joined AS (
    SELECT
        e.event_id,
        e.user_id,
        e.event_type,
        e.device_type,
        e.platform,
        e.event_timestamp,
        
        -- Dimensions
        COALESCE(u.subscription_tier, 'Unknown') AS user_subscription_tier,
        COALESCE(u.country, 'Unknown') AS user_country,
        
        -- Derived metrics
        DATE_TRUNC('hour', e.event_timestamp) AS event_hour,
        
        -- A simple session grouping logic placeholder (could use window functions)
        CASE 
            WHEN e.event_type = 'login' THEN 1
            ELSE 0
        END AS is_session_start

    FROM staging_events e
    LEFT JOIN dim_users u
        ON e.user_id = u.user_id
)

SELECT * FROM joined
