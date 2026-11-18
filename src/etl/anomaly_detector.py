import logging
import statistics
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

# 1.4826 * MAD is a robust estimate of the standard deviation for normal data.
MAD_TO_SIGMA = 1.4826


def filter_anomalies(
    records: List[Dict[str, Any]],
    target_key: str = "temperature_2m",
    sigma_threshold: float = 2.0,
    window_hours: int = 3,
    min_deviation: float = 2.5,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Flags sudden spikes/drops (sensor faults, corrupted values) in an hourly,
    time-ordered series using a local, slope-aware Hampel-style filter.

    For each reading, a robust straight line (Theil–Sen: median of pairwise
    slopes) is fitted through its neighbours within ±`window_hours`, leaving the
    reading itself out. The reading is anomalous when it deviates from that
    line's value at its own hour by more than `sigma_threshold` robust standard
    deviations (1.4826 × MAD of the neighbours' residuals) AND by more than
    `min_deviation` (in the metric's own unit).

    Why local: a single mean/σ over a multi-day window mixes day and night, so
    normal afternoon peaks and night-time lows were flagged as outliers. A short
    window follows the daily cycle and slow weather changes (e.g. fronts), and
    the fitted slope keeps sensitivity on the steep morning/evening parts of the
    cycle, so only abrupt, isolated jumps are flagged. `min_deviation` stops
    very smooth windows (MAD ≈ 0) from flagging tiny wiggles; it is doubled for
    the first/last `window_hours` readings, where the fit is one-sided.

    A second pass re-checks every flagged reading with the other flagged
    readings left out, so a multi-hour fault doesn't get clean neighbours
    flagged along with it.

    Args:
        records: Parsed readings, ordered by time.
        target_key: The metric to analyze (e.g. 'temperature_2m').
        sigma_threshold: Robust σ multiplier (config: anomaly_sigma_threshold).
        window_hours: Neighbours on each side used for the local line fit.
        min_deviation: Smallest absolute deviation that can count as anomalous.

    Returns:
        A tuple of (clean_records, anomalous_records).
    """
    if not records:
        return [], []

    indexed = [(i, r[target_key]) for i, r in enumerate(records) if r.get(target_key) is not None]
    if len(indexed) < 2 * window_hours + 1:
        logger.warning(f"Not enough valid data points for {target_key} to run the spike filter. Skipping anomaly detection.")
        return records, []

    values = [v for _, v in indexed]

    def is_outlier(pos: int, exclude: set) -> bool:
        neighbours = [
            (j - pos, values[j])
            for j in range(max(0, pos - window_hours), min(len(values), pos + window_hours + 1))
            if j != pos and j not in exclude
        ]
        if len(neighbours) < 3:
            return True  # can't re-check against clean neighbours; keep the first-pass verdict
        slope = statistics.median([
            (b[1] - a[1]) / (b[0] - a[0])
            for n, a in enumerate(neighbours) for b in neighbours[n + 1:]
        ])
        expected = statistics.median([y - slope * dx for dx, y in neighbours])
        robust_sigma = MAD_TO_SIGMA * statistics.median([abs(y - (expected + slope * dx)) for dx, y in neighbours])
        # Near either end of the series the fit is one-sided (extrapolated), so require twice
        # the minimum deviation there. This matters most for the newest hour (the NOW point).
        one_sided = pos < window_hours or pos >= len(values) - window_hours
        floor = min_deviation * (2 if one_sided else 1)
        return abs(values[pos] - expected) > max(sigma_threshold * robust_sigma, floor)

    # Pass 1 flags candidates. Pass 2 re-checks each candidate against its neighbours with
    # the other candidates left out, so a multi-hour fault doesn't drag clean neighbours in.
    candidates = {pos for pos in range(len(values)) if is_outlier(pos, set())}
    confirmed = {pos for pos in candidates if is_outlier(pos, candidates - {pos})}
    for _ in range(3):  # repeat until stable: re-check with only the confirmed hours left out
        refined = {pos for pos in candidates if is_outlier(pos, confirmed - {pos})}
        if refined == confirmed:
            break
        confirmed = refined
    anomalous_idx = {indexed[pos][0] for pos in confirmed}

    clean_records = [r for i, r in enumerate(records) if i not in anomalous_idx]
    anomalous_records = [r for i, r in enumerate(records) if i in anomalous_idx]

    logger.info(
        f"Spike filter on {target_key}: ±{window_hours}h local robust line, "
        f"threshold max({sigma_threshold}×robust σ, {min_deviation})"
    )
    if anomalous_records:
        logger.warning(f"DETECTED {len(anomalous_records)} ANOMALIES in {target_key} data stream!")
        for anomaly in anomalous_records:
            logger.warning(f"  -> Anomaly reading: {anomaly.get(target_key)} at {anomaly.get('time')}")

    return clean_records, anomalous_records
