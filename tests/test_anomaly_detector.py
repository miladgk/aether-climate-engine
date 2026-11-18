import math
from datetime import datetime, timedelta

from src.etl.anomaly_detector import filter_anomalies


def _series(hours=120, amplitude=6.0, front_at=None, front_size=0.0):
    """Hourly temperatures with a daily cycle peaking at 14:00, optionally a step change (a weather front)."""
    start = datetime(2026, 11, 14)
    out = []
    for i in range(hours):
        t = start + timedelta(hours=i)
        value = 12.0 + amplitude * math.cos((t.hour - 14) * math.pi / 12)
        if front_at is not None and i >= front_at:
            value += front_size
        out.append({"time": t.isoformat(), "temperature_2m": round(value, 1), "wind_speed_10m": 5.0})
    return out


def test_daily_peaks_and_lows_are_not_flagged():
    """The old global ±2σ filter dropped normal afternoon peaks; the local filter must keep them."""
    records = _series(amplitude=8.0)
    clean, anomalous = filter_anomalies(records, sigma_threshold=2.0)
    assert anomalous == []
    assert len(clean) == len(records)


def test_weather_front_is_not_flagged():
    """A gradual front (6 °C cooling spread over 6 hours) is real weather, not a fault."""
    records = _series()
    for k, r in enumerate(records[60:], start=0):
        r["temperature_2m"] = round(r["temperature_2m"] - min(6.0, k * 1.0), 1)
    _, anomalous = filter_anomalies(records, sigma_threshold=2.0)
    assert anomalous == []


def test_isolated_spike_and_drop_are_flagged():
    records = _series()
    records[30]["temperature_2m"] += 9.0   # sensor spike
    records[75]["temperature_2m"] -= 7.0   # sudden drop
    clean, anomalous = filter_anomalies(records, sigma_threshold=2.0)
    assert {r["time"] for r in anomalous} == {records[30]["time"], records[75]["time"]}
    assert len(clean) == len(records) - 2


def test_two_hour_fault_is_flagged():
    records = _series()
    records[50]["temperature_2m"] += 10.0
    records[51]["temperature_2m"] += 10.0
    _, anomalous = filter_anomalies(records, sigma_threshold=2.0)
    assert {r["time"] for r in anomalous} == {records[50]["time"], records[51]["time"]}


def test_small_wiggle_below_min_deviation_is_kept():
    records = [{"time": f"2026-11-14T{h:02d}:00", "temperature_2m": 10.0, "wind_speed_10m": 5.0} for h in range(24)]
    records[12]["temperature_2m"] = 11.5  # 1.5 °C bump in a perfectly flat window (MAD = 0), below the 2.5 °C floor
    _, anomalous = filter_anomalies(records, sigma_threshold=2.0, min_deviation=2.5)
    assert anomalous == []


def test_too_few_points_returns_everything_clean():
    records = _series(hours=5)
    clean, anomalous = filter_anomalies(records)
    assert clean == records and anomalous == []


def test_newest_hour_needs_a_larger_jump_to_be_dropped():
    """The last reading is the NOW point and its fit is one-sided, so the floor is doubled there."""
    records = _series(hours=48)
    records[-1]["temperature_2m"] += 3.5  # would pass the 2.5 °C floor mid-series, not at the edge
    _, anomalous = filter_anomalies(records, sigma_threshold=2.0, min_deviation=2.5)
    assert anomalous == []
    records[-1]["temperature_2m"] += 6.0  # a clear fault is still caught
    _, anomalous = filter_anomalies(records, sigma_threshold=2.0, min_deviation=2.5)
    assert [r["time"] for r in anomalous] == [records[-1]["time"]]


def test_wind_spike_is_flagged_but_normal_gusty_wind_is_kept():
    """The same filter runs on wind with its own floor (12 km/h in config)."""
    records = _series()
    for i, r in enumerate(records):
        r["wind_speed_10m"] = round(10.0 + 4.0 * math.cos((i % 24 - 16) * math.pi / 12) + (2.5 if i % 3 == 0 else 0.0), 1)
    _, anomalous = filter_anomalies(records, target_key="wind_speed_10m", sigma_threshold=2.0, min_deviation=12.0)
    assert anomalous == []
    records[40]["wind_speed_10m"] += 30.0  # anemometer glitch
    _, anomalous = filter_anomalies(records, target_key="wind_speed_10m", sigma_threshold=2.0, min_deviation=12.0)
    assert [r["time"] for r in anomalous] == [records[40]["time"]]
