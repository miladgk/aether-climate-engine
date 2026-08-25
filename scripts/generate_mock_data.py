import json
import random
import uuid
from datetime import datetime, timezone

def generate_sample_payload(num_records=5000):
    events = ["login", "page_view", "click", "checkout", "error"]
    records = []
    for _ in range(num_records):
        record = {
            "event_id": str(uuid.uuid4()),
            "user": {
                "id": random.randint(1000, 9999),
                "ip_address": f"192.168.1.{random.randint(1, 255)}"
            },
            "event_type": random.choice(events),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "browser": "Chrome",
                "duration_ms": random.randint(50, 2000)
            }
        }
        records.append(record)
    
    with open("sample_telemetry.json", "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

if __name__ == "__main__":
    generate_sample_payload()
