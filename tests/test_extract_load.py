import json
import pytest
import os
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

def test_malformed_json_handling(s3_mock, mock_postgres):
    """
    Feed deliberately malformed JSON to ensure the pipeline 
    skips the bad lines, routes to DLQ, and continues processing.
    """
    if os.path.exists("dead_letter_queue.dlq"):
        os.remove("dead_letter_queue.dlq")
        
    execution_date = "2026-08-24"
    prefix = f"telemetry_logs/{execution_date}/"
    file_key = f"{prefix}logs_001.json"
    
    # 2 valid lines, 1 malformed
    content = '{"event_id": 1}\n{"event_id": 2, malformed...}\n{"event_id": 3}'
    s3_mock.put_object(Bucket='test-bucket', Key=file_key, Body=content.encode('utf-8'))
    
    result = run_daily_ingestion(execution_date)
    
    assert result['status'] == 'success'
    assert result['rows_processed'] == 2
    
    # Assert DLQ was created and contains the malformed line
    assert os.path.exists("dead_letter_queue.dlq")
    with open("dead_letter_queue.dlq", "r") as f:
        dlq_content = f.read()
    assert '{"event_id": 2, malformed...}' in dlq_content

def test_batch_insert_threshold(s3_mock, mock_postgres, mocker):
    """
    Simulate a 120,000 row data stream to assert that the batch-insert 
    logic triggers exactly in chunks (50k, 50k, 20k).
    """
    mocker.patch('src.etl.extract_load.BATCH_SIZE', 50000)
    
    execution_date = "2026-08-25"
    prefix = f"telemetry_logs/{execution_date}/"
    file_key = f"{prefix}logs_002.json"
    
    # Generate 120,000 lines of valid JSON
    lines = [json.dumps({"event_id": i}) for i in range(120000)]
    content = "\n".join(lines)
    
    s3_mock.put_object(Bucket='test-bucket', Key=file_key, Body=content.encode('utf-8'))
    
    result = run_daily_ingestion(execution_date)
    
    assert result['status'] == 'success'
    assert result['rows_processed'] == 120000
    
    # 120k / 50k = 2 full batches + 1 remainder batch = 3 calls
    assert mock_postgres.insert_batch.call_count == 3
    
    # Assert call arguments
    args = mock_postgres.insert_batch.call_args_list
    assert len(args[0][0][0]) == 50000
    assert len(args[1][0][0]) == 50000
    assert len(args[2][0][0]) == 20000

def test_database_rollback(s3_mock, mocker):
    """
    Mock a transient database write error to verify that the transaction 
    fails cleanly.
    """
    execution_date = "2026-08-26"
    prefix = f"telemetry_logs/{execution_date}/"
    file_key = f"{prefix}logs_003.json"
    
    content = '{"event_id": 1}\n{"event_id": 2}'
    s3_mock.put_object(Bucket='test-bucket', Key=file_key, Body=content.encode('utf-8'))
    
    # Mock PostgresClient to raise an exception on insert
    mock_client = mocker.patch('src.etl.extract_load.PostgresClient')
    mock_instance = mock_client.return_value
    mock_instance.insert_batch.side_effect = DatabaseError("Simulated write error")
    
    result = run_daily_ingestion(execution_date)
    
    assert result['status'] == 'failed'
    assert 'Simulated write error' in result['error']
    assert result['rows_processed'] == 0
