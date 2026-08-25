from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import sys
import os

# Add the project root to sys.path so we can import src modules
# In a real deployment, this path should be managed via PYTHONPATH or Docker image
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.etl.extract_load import run_daily_ingestion

default_args = {
    'owner': 'data_engineering',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}

def ingestion_wrapper(**kwargs):
    """
    Wrapper function to extract the execution date from Airflow kwargs
    and pass it to the orchestrator.
    """
    ds = kwargs.get('ds') # 'YYYY-MM-DD' formatted logical execution date
    if not ds:
        raise ValueError("Execution date (ds) not found in kwargs")
    
    result = run_daily_ingestion(execution_date=ds)
    if result.get("status") != "success":
        raise Exception(f"Ingestion failed: {result.get('error')}")

with DAG(
    'daily_telemetry_ingestion',
    default_args=default_args,
    description='A daily DAG to ingest telemetry JSON logs from S3 to PostgreSQL',
    schedule_interval='@daily',
    start_date=datetime(2026, 8, 20), # arbitrary start date in the past
    catchup=False,
    tags=['telemetry', 'ingestion'],
) as dag:

    ingest_task = PythonOperator(
        task_id='ingest_telemetry_data',
        python_callable=ingestion_wrapper,
        provide_context=True,
    )

    ingest_task
