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
    # Bypass the on-disk response cache so a previous real run can't leak into the test
    mocker.patch('src.etl.cache_manager.get_cached_response', return_value=None)
    mocker.patch('src.etl.cache_manager.set_cached_response')
    
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
    
    mocker.patch('src.etl.cache_manager.get_cached_response', return_value=None)
    mocker.patch('src.etl.cache_manager.set_cached_response')

    # Mock PostgresClient to raise an exception on insert
    mock_client = mocker.patch('src.etl.extract_load.PostgresClient')
    mock_instance = mock_client.return_value
    mock_instance.insert_batch.side_effect = DatabaseError("Simulated write error")
    
    result = run_daily_ingestion("2026-08-24")
    
    # In the new architecture, it falls back to writing JSON and returns success
    assert result['status'] == 'success'


def test_observed_window_is_recent_past_in_station_local_time(mocker):
    """
    Live rows are station-local (timezone=auto). Only hours up to the station's
    current local hour are kept, and only the latest `observed_window_hours`
    of them; that window is what the models are trained on.
    """
    from datetime import datetime, timedelta

    offset = 9 * 3600  # e.g. Tokyo
    local_now = (datetime.utcnow() + timedelta(seconds=offset)).replace(minute=0, second=0, microsecond=0)
    times = [(local_now + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(-71, 25)]  # 72 past + 24 future
    mock_urlopen = mocker.patch('urllib.request.urlopen')
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.read.return_value = json.dumps({
        "utc_offset_seconds": offset, "timezone": "Asia/Tokyo", "timezone_abbreviation": "JST",
        "hourly": {
            "time": times,
            "temperature_2m": [10.0 + (i % 24) * 0.1 for i in range(len(times))],
            "wind_speed_10m": [5.0 + (i % 24) * 0.1 for i in range(len(times))],
        },
    }).encode('utf-8')
    mock_response.__enter__.return_value = mock_response
    mock_urlopen.return_value = mock_response

    mocker.patch('json.load', return_value={
        "locations": [{"name": "Tokyo", "latitude": 35.68, "longitude": 139.69}],
        "anomaly_sigma_threshold": 2.0,
        "ml_prediction_hours": 24,
        "observed_window_hours": 48,
        "holdout_hours": 12,
    })
    mocker.patch('builtins.open', mocker.mock_open(read_data='{}'))
    mocker.patch('src.etl.extract_load.PostgresClient')
    mocker.patch('src.etl.cache_manager.get_cached_response', return_value=None)
    mocker.patch('src.etl.cache_manager.set_cached_response')
    mock_predict = mocker.patch('src.ml.predictor.generate_predictions', return_value=[])
    mock_holdout = mocker.patch('src.ml.predictor.evaluate_holdout', return_value={"temp_mae": 1.0, "wind_mae": 1.0, "n": 12})

    run_daily_ingestion("2026-08-24")

    forecast_url = mock_urlopen.call_args_list[0].args[0].full_url
    assert "timezone=auto" in forecast_url and "past_days=" in forecast_url
    assert mock_predict.call_count == 3
    training = mock_predict.call_args_list[0].args[0]
    assert len(training) == 48
    assert training[-1]["time"] == local_now.strftime("%Y-%m-%dT%H:%M")
    assert all(datetime.fromisoformat(r["time"]) <= local_now for r in training)
    assert mock_holdout.call_args_list[0].kwargs["holdout_hours"] == 12


def test_wind_spike_removes_record_and_dlq_names_the_metric(mocker):
    """A wind spike drops the whole hourly record and the DLQ entry says which metric triggered it."""
    from datetime import datetime, timedelta

    local_now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    times = [(local_now - timedelta(hours=47 - h)).strftime("%Y-%m-%dT%H:%M") for h in range(48)]
    winds = [8.0 + (h % 24) * 0.2 for h in range(48)]
    winds[20] += 40.0
    mock_urlopen = mocker.patch('urllib.request.urlopen')
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.read.return_value = json.dumps({
        "utc_offset_seconds": 0,
        "hourly": {"time": times, "temperature_2m": [10.0 + (h % 24) * 0.1 for h in range(48)], "wind_speed_10m": winds},
    }).encode('utf-8')
    mock_response.__enter__.return_value = mock_response
    mock_urlopen.return_value = mock_response
    mocker.patch('json.load', return_value={
        "locations": [{"name": "Berlin", "latitude": 52.52, "longitude": 13.41}],
        "ml_prediction_hours": 12, "observed_window_hours": 96,
    })
    mocked_open = mocker.patch('builtins.open', mocker.mock_open(read_data='{}'))
    mocker.patch('src.etl.extract_load.PostgresClient')
    mocker.patch('src.etl.cache_manager.get_cached_response', return_value=None)
    mocker.patch('src.etl.cache_manager.set_cached_response')
    mock_predict = mocker.patch('src.ml.predictor.generate_predictions', return_value=[])
    mocker.patch('src.ml.predictor.evaluate_holdout', return_value={})

    run_daily_ingestion("2026-08-24")

    training = mock_predict.call_args_list[0].args[0]
    assert times[20] not in [r["time"] for r in training]
    assert len(training) == 47
    written = "".join(c.args[0] for c in mocked_open().write.call_args_list)
    dlq_lines = [json.loads(l) for l in written.splitlines() if '"reason": "Anomaly' in l]
    assert [(d["reason"], d["record"]["time"]) for d in dlq_lines] == [("Anomaly: wind_speed_10m spike", times[20])]
