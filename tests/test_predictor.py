import pytest
from src.ml.predictor import _calculate_trend, _calculate_amplitude, generate_predictions
from datetime import datetime, timedelta

def test_calculate_trend_perfect_linear():
    """Test that the math engine correctly identifies a perfect linear trend."""
    # y = 2x + 10
    y_values = [10.0, 12.0, 14.0, 16.0, 18.0]
    m, b = _calculate_trend(y_values)
    assert m == 2.0
    assert b == 10.0

def test_calculate_amplitude():
    """Test the daily cyclical amplitude calculation."""
    # Mock 48 hours of data (2 days)
    # Day 1: min 10, max 20 -> amplitude 5
    # Day 2: min 12, max 22 -> amplitude 5
    # Avg amplitude should be 5
    y_values = []
    for day in range(2):
        for hour in range(24):
            if hour == 14:
                y_values.append(20.0 + (day * 2)) # Peak
            elif hour == 2:
                y_values.append(10.0 + (day * 2)) # Trough
            else:
                y_values.append(15.0 + (day * 2)) # Average
    
    amp = _calculate_amplitude(y_values, len(y_values))
    assert amp == 5.0

def test_generate_predictions_structure():
    """Test that the main prediction function outputs correct structural payload."""
    base_time = datetime(2026, 1, 1, 12, 0)
    mock_records = []
    
    # Generate 48 hours of mock data
    for i in range(48):
        mock_records.append({
            "time": (base_time + timedelta(hours=i)).isoformat(),
            "temperature_2m": 15.0 + (i * 0.1),
            "wind_speed_10m": 5.0 + (i * 0.05)
        })
        
    predictions = generate_predictions(mock_records, hours_to_predict=12)
    
    assert len(predictions) == 12
    assert "time" in predictions[0]
    assert "predicted_temperature_2m" in predictions[0]
    assert "predicted_wind_speed_10m" in predictions[0]


def _diurnal_records(hours, start=datetime(2026, 1, 1, 0, 0)):
    """Generated test station-local data: temperature peaks at 14:00, wind at 16:00 local time."""
    import math
    return [
        {
            "time": (start + timedelta(hours=i)).isoformat(),
            "temperature_2m": 10.0 + 5.0 * math.cos(((start + timedelta(hours=i)).hour - 14) * math.pi / 12),
            "wind_speed_10m": 8.0 + 3.0 * math.cos(((start + timedelta(hours=i)).hour - 16) * math.pi / 12),
        }
        for i in range(hours)
    ]


def test_forecast_peaks_at_local_14h():
    """The diurnal cycle follows the records' own (station-local) clock: the forecast peak lands at 14:00."""
    predictions = generate_predictions(_diurnal_records(96), hours_to_predict=24, method="sma")
    peak = max(predictions, key=lambda p: p["predicted_temperature_2m"])
    assert datetime.fromisoformat(peak["time"]).hour == 14


def test_forecast_starts_after_last_training_record():
    """Training uses the whole window passed in, so the forecast starts right after its last record."""
    records = _diurnal_records(96)
    predictions = generate_predictions(records, hours_to_predict=48)
    last = datetime.fromisoformat(records[-1]["time"])
    assert predictions[0]["time"] == (last + timedelta(hours=1)).isoformat()


def test_evaluate_holdout_scores_last_hours():
    from src.ml.predictor import evaluate_holdout

    metrics = evaluate_holdout(_diurnal_records(96), holdout_hours=24, method="linear")
    assert metrics["n"] == 24
    assert metrics["temp_mae"] >= 0 and metrics["wind_mae"] >= 0
    # A clean 5 °C-amplitude local-time sinusoid should be tracked closely.
    assert metrics["temp_mae"] < 2.0

    assert evaluate_holdout(_diurnal_records(40), holdout_hours=24) == {}
