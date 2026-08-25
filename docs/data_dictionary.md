# Project Aether: Data Dictionary

Welcome to the ultimate source of truth for the Project Aether data models. This document translates the technical output of our ETL pipeline into standardized business nomenclature.

## Core Entities

### `fct_user_events`
The central fact table representing every action a user takes on our platforms.

| Metric / Field | Business Definition | Technical Calculation | BI Dashboards Used In |
| --- | --- | --- | --- |
| **User ID** | The unique identifier of the customer. *(Note: Classified as PII)* | Passed natively from the telemetry payload. | Growth, User Journey |
| **Event Type** | The specific action taken by the user. | Standardized strings (e.g. `login`, `click`, `purchase`). | All Dashboards |
| **Session Start** | An indicator that the user has begun a new active session. | Flagged as `1` when `event_type = 'login'`, else `0`. | Engagement, Retention |
| **Session Duration** | The time elapsed during an active user session. | Timestamp difference between a `login` event and the subsequent `logout` event for the same `user_id`. | Engagement |

## Known Caveats & Data SLAs
- **Latency**: Data is ingested in daily batch intervals at midnight UTC. Dashboards querying this data will be up to 24 hours delayed.
- **Duplicate Handling**: If the telemetry client drops connection and retries, S3 may receive duplicate payloads. The dbt pipeline enforces `event_id` uniqueness, effectively ignoring duplicates during materialization.
- **Null Geographies**: `user_country` may show up as `Unknown` if the IP resolution service fails during the upstream dimension creation.

## Self-Serve Access
If you are a Product Manager or Analyst looking to explore this data, please request access to the `telemetry_db` via the internal IT portal and connect your preferred BI tool directly to the `fct_user_events` physical table.
