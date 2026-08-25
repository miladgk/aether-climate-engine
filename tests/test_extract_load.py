import json
import pytest
import os
from unittest.mock import MagicMock
from src.infrastructure.postgres_connector import DatabaseError
from src.etl.extract_load import run_daily_ingestion, _flatten_json

def test_flatten_json():
    """Verify that nested JSON is correctly flattened."""
    raw = {
        "user": {"id": 123},
        "event_type": "click",
        "timestamp": "2026-08-24T19:14:29"
    }
    expected = {
        "user_id": 123,
        "event_type": "click",
        "timestamp": "2026-08-24T19:14:29"
    }
    assert _flatten_json(raw) == expected

def test_ingestion_success(mocker):
    """
    Mock the urllib.request to return a valid open-meteo response
    and verify the pipeline processes the data.
    """
    if os.path.exists("dead_letter_queue.dlq"):
        os.remove("dead_letter_queue.dlq")
        
    mock_urlopen = mocker.patch('urllib.request.urlopen')
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.read.return_value = json.dumps({
        "latitude": 52.52, "longitude": 13.41,
        "hourly": {
            "time": ["2026-08-24T00:00", "2026-08-24T01:00"],
            "temperature_2m": [15.0, 15.5],
            "wind_speed_10m": [10.0, 11.0]
        }
    }).encode('utf-8')
    mock_response.__enter__.return_value = mock_response
    mock_urlopen.return_value = mock_response
    
    # Mock config to only test Berlin
    mocker.patch('json.load', return_value={
        "locations": [{"name": "Berlin", "latitude": 52.52, "longitude": 13.41}],
        "anomaly_sigma_threshold": 2.0,
        "ml_prediction_hours": 48
    })
    # Mock built-in open for config load
    mocker.patch('builtins.open', mocker.mock_open(read_data='{}'))

    # Also mock Postgres to avoid real connection attempts
    mocker.patch('src.etl.extract_load.PostgresClient')
    
    result = run_daily_ingestion("2026-08-24")
    
    assert result['status'] == 'success'
    # 2 live + 2 historical = 4 rows processed
    assert result['rows_processed'] == 4 

def test_database_graceful_degradation(mocker):
    """
    Verify that if Postgres fails, the pipeline degrades gracefully
    and still succeeds (writes to JSON).
    """
    mock_urlopen = mocker.patch('urllib.request.urlopen')
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.read.return_value = json.dumps({
        "hourly": {
            "time": ["2026-08-24T00:00"],
            "temperature_2m": [15.0],
            "wind_speed_10m": [10.0]
        }
    }).encode('utf-8')
    mock_response.__enter__.return_value = mock_response
    mock_urlopen.return_value = mock_response
    
    mocker.patch('json.load', return_value={
        "locations": [{"name": "Berlin", "latitude": 52.52, "longitude": 13.41}],
    })
    mocker.patch('builtins.open', mocker.mock_open(read_data='{}'))
    
    # Mock PostgresClient to raise an exception on insert
    mock_client = mocker.patch('src.etl.extract_load.PostgresClient')
    mock_instance = mock_client.return_value
    mock_instance.insert_batch.side_effect = DatabaseError("Simulated write error")
    
    result = run_daily_ingestion("2026-08-24")
    
    # In the new architecture, it falls back to writing JSON and returns success
    assert result['status'] == 'success'
