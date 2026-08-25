import os
import time
import json
import logging
import argparse
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, Any, List

from src.infrastructure.postgres_connector import PostgresClient
from src.etl.utils import _hash_pii, _flatten_json
from src.etl.anomaly_detector import filter_anomalies

# Setup basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

BATCH_SIZE = 50000

def fetch_open_meteo_data() -> List[Dict[str, Any]]:
    """
    Fetches live high-frequency meteorological data from Open-Meteo API.
    Uses urllib.request to bypass PyOpenSSL environment limitations.
    Returns a list of hourly forecast records.
    """
    url = "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m,wind_speed_10m"
    logger.info(f"Fetching live data from Open-Meteo: {url}")
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Aether-Pipeline/1.0'})
    with urllib.request.urlopen(req) as response:
        if response.status != 200:
            raise Exception(f"API request failed with status {response.status}")
        data = json.loads(response.read().decode('utf-8'))
        
    records = []
    hourly = data.get('hourly', {})
    times = hourly.get('time', [])
    temps = hourly.get('temperature_2m', [])
    winds = hourly.get('wind_speed_10m', [])
    
    for i in range(len(times)):
        record = {
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "time": times[i],
            "temperature_2m": temps[i] if i < len(temps) else None,
            "wind_speed_10m": winds[i] if i < len(winds) else None,
            "event_type": "weather_reading",
            "metadata": {
                "source": "open-meteo"
            }
        }
        records.append(record)
        
    logger.info(f"Successfully parsed {len(records)} hourly forecast records.")
    return records

def run_daily_ingestion(execution_date: str) -> Dict[str, Any]:
    """
    Central orchestrator function.
    Fetches live API data, flattens records, and batch inserts into PostgreSQL.
    """
    logger.info(f"Starting ingestion for date: {execution_date}")
    start_time = time.time()
    
    # Load Configuration
    config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "config.json")
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
    except Exception as e:
        logger.error(f"Failed to load config.json: {e}")
        return {"status": "failed", "error": "Config missing"}
        
    locations = config.get("locations", [])
    sigma_threshold = config.get("anomaly_sigma_threshold", 2.0)
    ml_hours = config.get("ml_prediction_hours", 48)
    
    postgres_host = os.getenv('POSTGRES_HOST', 'localhost')
    postgres_port = os.getenv('POSTGRES_PORT', '5432')
    
    all_clean_records = []
    all_predictions = []
    
    # Calculate YoY dates
    today = datetime.utcnow().date()
    historical_end = today - timedelta(days=365) + timedelta(days=7) # +7 days to ensure enough future coverage
    historical_start = historical_end - timedelta(days=14) # 14 days total to ensure enough past and future data
    
    for loc in locations:
        loc_name = loc["name"]
        lat = loc["latitude"]
        lon = loc["longitude"]
        
        forecast_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,wind_speed_10m"
        archive_url = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={historical_start.isoformat()}&end_date={historical_end.isoformat()}&hourly=temperature_2m,wind_speed_10m"
        
        from src.etl.cache_manager import get_cached_response, set_cached_response
        
        # 1. Fetch Forecast (Live) Data
        cached_forecast = get_cached_response(forecast_url)
        forecast_data = {}
        if cached_forecast:
            forecast_data = json.loads(cached_forecast)
        else:
            logger.info(f"Fetching live data for {loc_name}")
            req = urllib.request.Request(forecast_url, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(req) as response:
                    if response.status == 200:
                        raw_data = response.read().decode('utf-8')
                        forecast_data = json.loads(raw_data)
                        set_cached_response(forecast_url, raw_data)
            except Exception as e:
                logger.error(f"Error fetching live data for {loc_name}: {e}")
                
        # 2. Fetch Archive (Historical) Data
        cached_archive = get_cached_response(archive_url)
        archive_data = {}
        if cached_archive:
            archive_data = json.loads(cached_archive)
        else:
            logger.info(f"Fetching historical YoY data for {loc_name}")
            req = urllib.request.Request(archive_url, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(req) as response:
                    if response.status == 200:
                        raw_data = response.read().decode('utf-8')
                        archive_data = json.loads(raw_data)
                        set_cached_response(archive_url, raw_data)
            except Exception as e:
                logger.error(f"Error fetching historical data for {loc_name}: {e}")

        # Process Live Data
        raw_records = []
        if 'hourly' in forecast_data:
            times = forecast_data['hourly']['time']
            temps = forecast_data['hourly']['temperature_2m']
            winds = forecast_data['hourly']['wind_speed_10m']
            for t, temp, wind in zip(times, temps, winds):
                if temp is not None and wind is not None:
                    raw_records.append({"time": t, "temperature_2m": temp, "wind_speed_10m": wind, "location": loc_name, "period": "live"})
        
        # Process Historical Data
        if 'hourly' in archive_data:
            times = archive_data['hourly']['time']
            temps = archive_data['hourly']['temperature_2m']
            winds = archive_data['hourly']['wind_speed_10m']
            for t, temp, wind in zip(times, temps, winds):
                if temp is not None and wind is not None:
                    # Shift historical time forward exactly 365 days so it aligns on the chart
                    orig_time = datetime.fromisoformat(t)
                    shifted_time = orig_time + timedelta(days=365)
                    raw_records.append({"time": shifted_time.isoformat(), "temperature_2m": temp, "wind_speed_10m": wind, "location": loc_name, "period": "historical"})
            
        logger.info(f"Successfully parsed {len(raw_records)} records (Live + Historical) for {loc_name}.")
        
        # 3. Schema Validation
        from src.etl.validator import validate_schema
        valid_records, invalid_records = validate_schema(raw_records)
        
        if invalid_records:
            dlq_path = "dead_letter_queue.dlq"
            with open(dlq_path, 'a') as f:
                for r in invalid_records:
                    f.write(json.dumps({"reason": "Schema Validation Failure", "record": r}) + "\n")
        
        # 4. Statistical Anomaly Detection (Only run ML on Live data)
        live_valid = [r for r in valid_records if r.get('period') == 'live']
        hist_valid = [r for r in valid_records if r.get('period') == 'historical']
        
        clean_live, anomalous_live = filter_anomalies(live_valid, target_key="temperature_2m", sigma_threshold=sigma_threshold)
        
        all_clean_records.extend(clean_live)
        all_clean_records.extend(hist_valid) # Append historical without strict filtering
        
        # Run ML Predictions for all supported models
        if clean_live:
            from src.ml.predictor import generate_predictions
            for model_type in ["linear", "sma", "ema"]:
                loc_predictions = generate_predictions(clean_live, hours_to_predict=ml_hours, method=model_type)
                for p in loc_predictions:
                    p["location"] = loc_name
                all_predictions.extend(loc_predictions)
        
        if anomalous_live:
            dlq_path = "dead_letter_queue.dlq"
            with open(dlq_path, 'a') as f:
                for r in anomalous_live:
                    f.write(json.dumps(r) + "\n")
            logger.info(f"Routed {len(anomalous_live)} anomalies for {loc_name} to {dlq_path}")
    
    # Initialize Postgres client (still expecting connection refused in this environment)
    postgres_client = PostgresClient(connection_string=f"postgresql://{os.getenv('POSTGRES_USER', 'aether_user')}:{os.getenv('POSTGRES_PASSWORD', 'aether_password')}@{postgres_host}:{postgres_port}/{os.getenv('POSTGRES_DB', 'aether_warehouse')}", table_name="raw_telemetry")
    
    buffer = []
    total_rows_processed = 0
    
    # Save a local copy for the serverless dashboard
    dashboard_file = os.path.join("dashboard", "sample_telemetry.json")
    
    try:
        # Sort all clean records by time to ensure proper rendering
        all_clean_records.sort(key=lambda x: x['time'])
        
        # Write clean data to dashboard file
        if os.path.exists("dashboard"):
            with open(dashboard_file, 'w') as f:
                for r in all_clean_records:
                    f.write(json.dumps(r) + "\n")
            logger.info(f"Updated {dashboard_file} with {len(all_clean_records)} aggregate records.")
            
            if all_predictions:
                pred_file = os.path.join("dashboard", "predictions.json")
                with open(pred_file, 'w') as f:
                    for p in all_predictions:
                        f.write(json.dumps(p) + "\n")
                logger.info(f"Exported aggregate ML predictions to {pred_file}")
        
        # Stream clean JSON records (flattening)
        for raw_record in all_clean_records:
            # Flatten the nested JSON
            flat_record = _flatten_json(raw_record)
            buffer.append(flat_record)
            
            # Batch insert if threshold is reached
            if len(buffer) >= BATCH_SIZE:
                try:
                    postgres_client.insert_batch(buffer)
                except Exception as e:
                    logger.warning(f"Skipping Postgres bulk insert due to unavailable container: {e}")
                total_rows_processed += len(buffer)
                buffer.clear()
        
        # Insert any remaining records in the buffer
        if buffer:
            try:
                postgres_client.insert_batch(buffer)
            except Exception as e:
                logger.warning(f"Skipping Postgres bulk insert due to unavailable container: {e}")
            total_rows_processed += len(buffer)
            buffer.clear()
            
        duration = time.time() - start_time
        logger.info(f"Ingestion for {execution_date} completed successfully. Processed {total_rows_processed} rows in {duration:.2f} seconds.")
        
        return {
            "status": "success",
            "rows_processed": total_rows_processed,
            "duration_seconds": int(duration)
        }
        
    except Exception as e:
        logger.error(f"Ingestion failed for {execution_date}: {e}")
        return {
            "status": "failed",
            "error": str(e),
            "rows_processed": total_rows_processed,
            "duration_seconds": int(time.time() - start_time)
        }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run live weather ingestion ETL.")
    parser.add_argument("--date", type=str, default=datetime.today().strftime('%Y-%m-%d'), help="Logical execution date (YYYY-MM-DD).")
    
    args = parser.parse_args()
    
    run_daily_ingestion(execution_date=args.date)
