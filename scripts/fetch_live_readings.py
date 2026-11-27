#!/usr/bin/env python3
"""
Lightweight real-time weather readings fetcher.
Modeled after industrial-energy-sql-pipeline's hourly fast export.
Fetches only the current 15-minute readings for configured stations in parallel (<2 seconds).
Outputs to docs/live_latest.json which is git-ignored so hourly Pages deploys leave no git commits.
"""

import concurrent.futures
import datetime
import json
import os
import sys
import urllib.request

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "config.json")
OUTPUT_PATH = os.path.join(ROOT_DIR, "docs", "live_latest.json")

def fetch_station(station: dict) -> tuple:
    name = station["name"]
    lat = station["latitude"]
    lon = station["longitude"]
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,wind_speed_10m&timezone=auto"

    for attempt in range(3):
        req = urllib.request.Request(url, headers={"User-Agent": "Aether-Climate-Engine/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                current = data.get("current", {})
                return name, {
                    "temperature_2m": current.get("temperature_2m"),
                    "wind_speed_10m": current.get("wind_speed_10m"),
                    "time": current.get("time"),
                    "timezone": data.get("timezone"),
                    "utc_offset_seconds": data.get("utc_offset_seconds"),
                    "latitude": data.get("latitude"),
                    "longitude": data.get("longitude"),
                    "elevation": data.get("elevation"),
                }
        except Exception as exc:
            if "429" in str(exc) and attempt < 2:
                import time
                time.sleep(1.5 * (attempt + 1))
                continue
            print(f"[WARN] Failed to fetch current readings for {name} (attempt {attempt+1}): {exc}", file=sys.stderr)
            return name, None
    return name, None

def main():
    if not os.path.exists(CONFIG_PATH):
        print(f"[ERROR] Config not found: {CONFIG_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    stations = cfg.get("locations", [])
    if not stations:
        print("[ERROR] No locations in config.json", file=sys.stderr)
        sys.exit(1)

    import time
    readings = {}
    for s in stations:
        name, res = fetch_station(s)
        if res:
            readings[name] = res
        time.sleep(0.3)

    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "generated_at_utc": now_utc,
        "readings": readings,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"[INFO] Successfully fetched current live readings for {len(readings)}/{len(stations)} stations at {now_utc}")
    print(f"[INFO] Wrote {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
