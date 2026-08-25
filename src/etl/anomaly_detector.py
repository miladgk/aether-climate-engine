import logging
import statistics
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

def filter_anomalies(records: List[Dict[str, Any]], target_key: str = "temperature_2m", sigma_threshold: float = 2.0) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Identifies and filters anomalies in a time-series dataset using standard deviation.
    
    Args:
        records: A list of parsed data dictionaries.
        target_key: The metric to analyze for anomalies (e.g., 'temperature_2m').
        sigma_threshold: The number of standard deviations from the mean that constitutes an anomaly.
        
    Returns:
        A tuple of (clean_records, anomalous_records).
    """
    if not records:
        return [], []
        
    # Extract the target values, ignoring None or missing keys
    values = [r[target_key] for r in records if target_key in r and r[target_key] is not None]
    
    if len(values) < 2:
        logger.warning(f"Not enough valid data points for {target_key} to calculate variance. Skipping anomaly detection.")
        return records, []
        
    mean = statistics.mean(values)
    stdev = statistics.stdev(values)
    
    upper_bound = mean + (sigma_threshold * stdev)
    lower_bound = mean - (sigma_threshold * stdev)
    
    logger.info(f"Anomaly Detection Baseline for {target_key}: Mean={mean:.2f}, StDev={stdev:.2f}")
    logger.info(f"Threshold Bounds (±{sigma_threshold}σ): [{lower_bound:.2f}, {upper_bound:.2f}]")
    
    clean_records = []
    anomalous_records = []
    
    for record in records:
        val = record.get(target_key)
        if val is None:
            clean_records.append(record)
        elif lower_bound <= val <= upper_bound:
            clean_records.append(record)
        else:
            anomalous_records.append(record)
            
    if anomalous_records:
        logger.warning(f"DETECTED {len(anomalous_records)} ANOMALIES in {target_key} data stream!")
        for anomaly in anomalous_records:
            logger.warning(f"  -> Anomaly reading: {anomaly.get(target_key)} at {anomaly.get('time')}")
            
    return clean_records, anomalous_records
