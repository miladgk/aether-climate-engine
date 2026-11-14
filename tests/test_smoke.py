"""
Smoke tests: a fast, shallow pass over the whole system to answer one question —
"is this build broken in an obvious way?" These run in seconds and don't touch
any external service (no network, no database), so they are meant to catch
import errors, broken config files, and crashes in the core pipeline stages
*before* investing time in the slower integration/unit suite.
"""
import json
import os

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_core_modules_import():
    """Every core pipeline module should import cleanly with no side effects or errors."""
    import src.etl.extract_load  # noqa: F401
    import src.etl.anomaly_detector  # noqa: F401
    import src.etl.validator  # noqa: F401
    import src.etl.cache_manager  # noqa: F401
    import src.etl.utils  # noqa: F401
    import src.ml.predictor  # noqa: F401
    import src.infrastructure.postgres_connector  # noqa: F401
    import src.infrastructure.s3_connector  # noqa: F401


def test_config_json_is_valid_and_complete():
    """config.json must exist, parse as JSON, and declare at least one monitoring location."""
    config_path = os.path.join(PROJECT_ROOT, "config.json")
    assert os.path.exists(config_path), "config.json is missing from the project root"

    with open(config_path, "r") as f:
        config = json.load(f)

    assert "locations" in config
    assert len(config["locations"]) > 0
    for loc in config["locations"]:
        assert "name" in loc and "latitude" in loc and "longitude" in loc


def test_anomaly_detection_runs_end_to_end_on_tiny_dataset():
    """The anomaly detector should run without raising on a minimal realistic input."""
    from src.etl.anomaly_detector import filter_anomalies

    records = [
        {"temperature_2m": 15.0, "time": "2026-01-01T00:00"},
        {"temperature_2m": 15.5, "time": "2026-01-01T01:00"},
        {"temperature_2m": 100.0, "time": "2026-01-01T02:00"},  # obvious outlier
    ]

    clean, anomalous = filter_anomalies(records, target_key="temperature_2m", sigma_threshold=1.0)
    assert len(clean) + len(anomalous) == len(records)


def test_ml_predictor_runs_end_to_end_for_every_model():
    """Each supported ML model (linear/sma/ema) should produce predictions without crashing."""
    from datetime import datetime, timedelta

    from src.ml.predictor import generate_predictions

    base_time = datetime(2026, 1, 1)
    records = [
        {
            "temperature_2m": 15.0 + i * 0.1,
            "wind_speed_10m": 10.0,
            "time": (base_time + timedelta(hours=i)).isoformat(),
        }
        for i in range(48)
    ]

    for method in ["linear", "sma", "ema"]:
        predictions = generate_predictions(records, hours_to_predict=6, method=method)
        assert isinstance(predictions, list)
        assert len(predictions) > 0


def test_dashboard_static_assets_exist():
    """The dashboard's critical static files must be present for the live site to render."""
    dashboard_dir = os.path.join(PROJECT_ROOT, "dashboard")
    for filename in ["index.html", "favicon.svg"]:
        assert os.path.exists(os.path.join(dashboard_dir, filename)), f"dashboard/{filename} is missing"
