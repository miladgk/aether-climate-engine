"""
Serve the built Aether dashboard locally.

The UI is a Vite/React app in web/ that builds to web/dist/. The pipeline writes its
outputs to docs/. This server serves the UI from web/dist/ and the three data files
straight from docs/, so a fresh ETL run is visible without rebuilding the UI.

    cd web && npm ci && npm run build   # once, or after UI changes
    python3 scripts/serve_dashboard.py  # re-runs the ETL, then serves http://localhost:8000

For UI development with hot reload use `cd web && npm run dev` instead.
"""
import http.server
import logging
import os
import socket
import socketserver
import sys
from datetime import datetime

# Ensure repository root is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

PORT = 8000
DIST_DIR = os.path.join(BASE_DIR, "web", "dist")
DATA_DIR = os.path.join(BASE_DIR, "docs")
DATA_FILES = frozenset({"sample_telemetry.json", "predictions.json", "station_summary.json"})


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    """Serves web/dist/, except the pipeline's JSON outputs, which come from docs/."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def translate_path(self, path):
        name = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if name in DATA_FILES:
            return os.path.join(DATA_DIR, name)
        return super().translate_path(path)

    def end_headers(self):
        if self.path.split("?", 1)[0].lstrip("/") in DATA_FILES:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def fetch_latest_telemetry():
    """Extract fresh meteorological telemetry and update dashboard data on startup."""
    logging.info("Fetching up-to-date live weather data and computing ML predictions...")
    try:
        from src.etl.extract_load import run_daily_ingestion
        today_str = datetime.today().strftime('%Y-%m-%d')
        result = run_daily_ingestion(execution_date=today_str)
        if result.get("status") == "success":
            logging.info(f"Live telemetry update complete: {result.get('rows_processed', 0)} rows processed.")
        else:
            logging.warning(f"Telemetry extraction returned non-success: {result}")
    except Exception as e:
        logging.error(f"Failed to auto-update telemetry on startup: {e}")


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, 'SO_REUSEPORT'):
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except Exception:
                pass
        super().server_bind()


def start_server():
    if not os.path.exists(os.path.join(DIST_DIR, "index.html")):
        logging.error("web/dist/ is missing. Build the dashboard first: cd web && npm ci && npm run build")
        sys.exit(1)

    # Auto-extract up-to-date telemetry data whenever the server is executed
    fetch_latest_telemetry()

    with ReusableTCPServer(("", PORT), DashboardHandler) as httpd:
        logging.info(f"Serving web/dist + docs/*.json at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logging.info("Shutting down server...")


if __name__ == "__main__":
    start_server()
