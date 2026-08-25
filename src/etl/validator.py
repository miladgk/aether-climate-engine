import logging
from typing import Dict, Any, List, Tuple

logger = logging.getLogger(__name__)

def validate_schema(records: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Pure Python strict schema validation (Data Contract).
    Ensures that every record strictly adheres to expected types before processing.
    Invalid records are quarantined.
    """
    valid_records = []
    invalid_records = []
    
    for r in records:
        try:
            # Check required keys exist
            if 'time' not in r or 'temperature_2m' not in r or 'wind_speed_10m' not in r:
                raise ValueError("Missing required telemetry keys")
                
            # Type checking
            if not isinstance(r['time'], str):
                raise TypeError("'time' must be a string (ISO format)")
            if not isinstance(r['temperature_2m'], (int, float)):
                raise TypeError("'temperature_2m' must be numeric")
            if not isinstance(r['wind_speed_10m'], (int, float)):
                raise TypeError("'wind_speed_10m' must be numeric")
                
            valid_records.append(r)
        except (ValueError, TypeError) as e:
            logger.error(f"Schema Validation Failed for record: {r}. Reason: {e}")
            invalid_records.append(r)
            
    if invalid_records:
        logger.warning(f"Quarantined {len(invalid_records)} records due to schema contract violations.")
        
    return valid_records, invalid_records
