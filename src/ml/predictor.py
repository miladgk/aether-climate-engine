import json
import logging
import datetime
import math
from typing import List, Dict, Any, Tuple

# Attempt to load Scikit-Learn (Graceful Degradation Architecture)
try:
    from sklearn.linear_model import LinearRegression
    import numpy as np
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

logger = logging.getLogger(__name__)

def _calculate_trend(y_values: List[float]) -> Tuple[float, float]:
    """
    Calculates the linear trend (m, b) for a given series of values.
    Uses Scikit-Learn if available, otherwise falls back to native Least Squares math.
    """
    n = len(y_values)
    if SKLEARN_AVAILABLE:
        # Use highly-optimized Scikit-Learn model
        logger.info("Using Scikit-Learn LinearRegression Engine.")
        X = np.array(range(n)).reshape(-1, 1)
        y = np.array(y_values)
        model = LinearRegression().fit(X, y)
        return model.coef_[0], model.intercept_
    else:
        # Fall back to native Pure Python Engine
        logger.info("Scikit-Learn unavailable. Falling back to Native Math Engine.")
        sum_x = sum(range(n))
        sum_y = sum(y_values)
        sum_x_squared = sum(i**2 for i in range(n))
        sum_xy = sum(i * val for i, val in enumerate(y_values))
        
        denominator = (n * sum_x_squared) - (sum_x ** 2)
        if denominator == 0:
            return 0.0, sum_y / n if n > 0 else 0.0
            
        m = ((n * sum_xy) - (sum_x * sum_y)) / denominator
        b = (sum_y - (m * sum_x)) / n
        return m, b

def _calculate_amplitude(y_values: List[float], n: int) -> float:
    """Calculates the average daily amplitude for cyclical variance."""
    amplitudes = []
    for day in range(min(3, n // 24)):
        day_vals = y_values[day*24:(day+1)*24]
        if day_vals:
            amplitudes.append((max(day_vals) - min(day_vals)) / 2)
    return sum(amplitudes) / len(amplitudes) if amplitudes else 5.0

def generate_predictions(records: List[Dict[str, Any]], hours_to_predict: int = 48, method: str = "linear") -> List[Dict[str, Any]]:
    """
    Generates time-series predictions for temperature and wind speed.
    Supports 'linear', 'sma', and 'ema' math models with cyclical variance.
    """
    if not records or len(records) < 24:
        logger.warning("Not enough data to train ML model.")
        return []

    # Use the last 72 hours for training
    training_data = records[:72]
    n = len(training_data)
    
    # Extract independent variables
    temps = [r.get('temperature_2m', 0) for r in training_data]
    winds = [r.get('wind_speed_10m', 0) for r in training_data]
    
    # 1. Linear Model (Global Trend)
    m_temp, b_temp = _calculate_trend(temps)
    m_wind, b_wind = _calculate_trend(winds)
    
    # 2. Simple Moving Average (SMA - last 12 periods)
    sma_temp = sum(temps[-12:]) / min(12, len(temps))
    sma_wind = sum(winds[-12:]) / min(12, len(winds))
    
    # 3. Exponential Smoothing (EMA)
    alpha = 0.3
    ema_temp = temps[0]
    for val in temps[1:]: ema_temp = (alpha * val) + ((1 - alpha) * ema_temp)
    ema_wind = winds[0]
    for val in winds[1:]: ema_wind = (alpha * val) + ((1 - alpha) * ema_wind)
    
    amp_temp = _calculate_amplitude(temps, n)
    amp_wind = _calculate_amplitude(winds, n)

    predictions = []
    last_record_time = datetime.datetime.fromisoformat(training_data[-1]['time'])
    
    # Calculate Residuals (Error Correction) for perfect smoothness
    last_temp_actual = training_data[-1].get('temperature_2m', 0)
    last_wind_actual = training_data[-1].get('wind_speed_10m', 0)
    last_x = n - 1
    
    if method == "sma":
        lin_last_temp, lin_last_wind = sma_temp, sma_wind
    elif method == "ema":
        lin_last_temp, lin_last_wind = ema_temp, ema_wind
    else: # Default linear
        lin_last_temp = (m_temp * last_x) + b_temp
        lin_last_wind = (m_wind * last_x) + b_wind
    
    last_hour_of_day = last_record_time.hour
    phase_shift_temp_last = (last_hour_of_day - 14) * (math.pi / 12)
    phase_shift_wind_last = (last_hour_of_day - 16) * (math.pi / 12)
    
    theoretical_last_temp = lin_last_temp + (amp_temp * math.cos(phase_shift_temp_last))
    theoretical_last_wind = lin_last_wind + (amp_wind * math.cos(phase_shift_wind_last))
    
    residual_temp = last_temp_actual - theoretical_last_temp
    residual_wind = last_wind_actual - theoretical_last_wind
    
    for i in range(1, hours_to_predict + 1):
        future_hour_index = last_x + i
        prediction_time = last_record_time + datetime.timedelta(hours=i)
        hour_of_day = prediction_time.hour
        
        # Base Trend Predictions
        if method == "sma":
            lin_pred_temp, lin_pred_wind = sma_temp, sma_wind
        elif method == "ema":
            lin_pred_temp, lin_pred_wind = ema_temp, ema_wind
        else:
            lin_pred_temp = (m_temp * future_hour_index) + b_temp
            lin_pred_wind = (m_wind * future_hour_index) + b_wind
        
        # Inject cyclical daily variance (Sine wave approximation)
        phase_shift_temp = (hour_of_day - 14) * (math.pi / 12)
        phase_shift_wind = (hour_of_day - 16) * (math.pi / 12)
        
        theoretical_temp = lin_pred_temp + (amp_temp * math.cos(phase_shift_temp))
        theoretical_wind = lin_pred_wind + (amp_wind * math.cos(phase_shift_wind))
        
        # Apply Exponentially Decaying Residual for perfectly smooth connection
        decay_factor = 0.85 ** i
        final_temp = theoretical_temp + (residual_temp * decay_factor)
        final_wind = theoretical_wind + (residual_wind * decay_factor)
        
        predictions.append({
            "time": prediction_time.isoformat(),
            "predicted_temperature_2m": round(final_temp, 2),
            "predicted_wind_speed_10m": round(max(0, final_wind), 2),
            "method": method
        })
        
    logger.info(f"Generated {hours_to_predict} hours of dual-metric ML predictions using {method} engine.")
    return predictions
