"""
Integration tests: verify that PostgresClient, running against a REAL PostgreSQL
instance (not a mock), correctly creates tables and writes/reads data.

Unit tests elsewhere mock PostgresClient entirely to test ETL logic in isolation.
These tests instead exercise the real SQL path (table creation + bulk insert via
psycopg2's execute_values), catching bugs that mocks cannot see: SQL syntax
errors, type mismatches, transaction handling, etc.

A real Postgres instance is required. CI provides one as a service container
(see .github/workflows/ci.yml). Locally, run:
    docker run -d -p 5432:5432 -e POSTGRES_USER=aether_user \
        -e POSTGRES_PASSWORD=aether_password -e POSTGRES_DB=aether_warehouse postgres:15
If no database is reachable, these tests are skipped automatically rather than failing.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from src.infrastructure.postgres_connector import PostgresClient

# NOTE: conftest.py unconditionally overwrites POSTGRES_HOST/PORT/USER/PASSWORD/DB
# with mock values for the unit test suite. These tests need the *real* database
# (the CI service container, or a local docker run), so they read a dedicated
# INTEGRATION_POSTGRES_* namespace instead, defaulting to the credentials
# .github/workflows/ci.yml configures for the postgres service container.
POSTGRES_HOST = os.getenv("INTEGRATION_POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("INTEGRATION_POSTGRES_PORT", "5432")
POSTGRES_USER = os.getenv("INTEGRATION_POSTGRES_USER", "aether_user")
POSTGRES_PASSWORD = os.getenv("INTEGRATION_POSTGRES_PASSWORD", "aether_password")
POSTGRES_DB = os.getenv("INTEGRATION_POSTGRES_DB", "aether_warehouse")

CONNECTION_STRING = (
    f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)


def _postgres_available() -> bool:
    try:
        engine = create_engine(CONNECTION_STRING)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except OperationalError:
        return False


requires_postgres = pytest.mark.skipif(
    not _postgres_available(),
    reason="No reachable PostgreSQL instance (set POSTGRES_HOST/PORT or run the CI service container).",
)


@pytest.fixture
def temp_table_name():
    """Use a unique table per test run so tests never collide or leave residue behind."""
    name = f"test_raw_telemetry_{uuid.uuid4().hex[:8]}"
    yield name
    # Teardown: drop the table even if the test failed mid-way.
    engine = create_engine(CONNECTION_STRING)
    with engine.connect() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {name}"))


@requires_postgres
def test_insert_batch_writes_real_rows(temp_table_name):
    """insert_batch() should create the table and persist rows that are then readable back."""
    client = PostgresClient(connection_string=CONNECTION_STRING, table_name=temp_table_name)

    records = [
        {"location": "Berlin", "temperature_2m": 15.0, "wind_speed_10m": 10.0},
        {"location": "Tokyo", "temperature_2m": 22.5, "wind_speed_10m": 5.0},
    ]

    result = client.insert_batch(records)
    assert result is True

    engine = create_engine(CONNECTION_STRING)
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT location, temperature_2m FROM {temp_table_name} ORDER BY location")).fetchall()

    assert len(rows) == 2
    assert rows[0].location == "Berlin"
    assert rows[1].location == "Tokyo"


@requires_postgres
def test_insert_batch_empty_list_is_noop(temp_table_name):
    """An empty batch should succeed without creating the table (nothing to insert)."""
    client = PostgresClient(connection_string=CONNECTION_STRING, table_name=temp_table_name)

    result = client.insert_batch([])
    assert result is True

    engine = create_engine(CONNECTION_STRING)
    with engine.connect() as conn:
        exists = conn.execute(
            text("SELECT to_regclass(:tbl)"), {"tbl": temp_table_name}
        ).scalar()
    assert exists is None


@requires_postgres
def test_insert_batch_is_additive_across_calls(temp_table_name):
    """Two separate insert_batch calls against the same table should both land (simulates batched ETL writes)."""
    client = PostgresClient(connection_string=CONNECTION_STRING, table_name=temp_table_name)

    client.insert_batch([{"location": "Berlin", "temperature_2m": 15.0}])
    client.insert_batch([{"location": "London", "temperature_2m": 12.0}])

    engine = create_engine(CONNECTION_STRING)
    with engine.connect() as conn:
        count = conn.execute(text(f"SELECT COUNT(*) FROM {temp_table_name}")).scalar()

    assert count == 2
