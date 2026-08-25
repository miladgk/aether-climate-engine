# Project Aether: Operations Runbook

This Standard Operating Procedure (SOP) outlines the incident response and maintenance protocols for the ETL pipeline.

## 1. Pipeline Overview
- **Orchestration**: Apache Airflow
- **Ingestion**: Python `boto3` stream to Postgres
- **Transformation**: dbt

## 2. Common Failure Modes & Troubleshooting

### Incident: Airflow DAG Failure (`daily_telemetry_ingestion`)
**Symptom**: You receive an alert that the DAG has failed after 3 retries.
**Potential Causes**:
- S3 Bucket is unreachable (AWS networking issue).
- Postgres Database is rejecting connections (Pool exhausted or credentials rotated).

**Response Steps**:
1. Check the Airflow UI logs for the specific `ingest_telemetry_data` task.
2. If it's a `DatabaseError`, verify the connection string in `.env` or check the Postgres instance health.
3. If it's a transient network issue, you can manually trigger a retry:
   - Navigate to the Airflow UI -> `daily_telemetry_ingestion`.
   - Click the failed task instance and select "Clear" to reset its state, allowing the scheduler to retry it immediately.

### Incident: dbt Data Quality Test Failure
**Symptom**: The downstream `dbt test` job fails and halts materialization.
**Potential Causes**:
- A new `event_type` was introduced by the frontend team but not added to the `accepted_values` list in `schema.yml`.
- Duplicate `event_id`s bypassed the uniqueness constraint.

**Response Steps**:
1. Run `dbt test` locally or view the CI logs to identify which constraint failed.
2. If a new event type was intentionally added, update the `accepted_values` array in `dbt_telemetry/models/staging/schema.yml` and commit the change.

## 3. Backfill Procedures
If a day's payload was missed or the ingestion script was modified to fix a bug, you must backfill historical data.

**Command to Backfill a Specific Date**:
Since the Airflow DAG is parameterized by `ds` (execution date), you can run a manual backfill via the Airflow CLI:
```bash
airflow dags backfill daily_telemetry_ingestion \
  --start-date 2026-08-20 \
  --end-date 2026-08-24
```
Ensure that `catchup=False` in the DAG definition does not prevent CLI backfills (it only prevents automatic scheduling catchups).
