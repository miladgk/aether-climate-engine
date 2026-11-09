import http.server
import socketserver
import os
import sys
import logging
from datetime import datetime

# Ensure repository root is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

socketserver.TCPServer.allow_reuse_address = True

PORT = 8000
DIRECTORY = "dashboard"

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        target_dir = os.path.join(BASE_DIR, DIRECTORY)
        super().__init__(*args, directory=target_dir, **kwargs)

    # Disable logging to avoid cluttering the test output
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

import socket

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
    target_dir = os.path.join(BASE_DIR, DIRECTORY)
    if not os.path.exists(target_dir):
        logging.error(f"Directory '{target_dir}' does not exist.")
        sys.exit(1)
        
    # Auto-extract up-to-date telemetry data whenever the server is executed
    fetch_latest_telemetry()
        
    with ReusableTCPServer(("", PORT), CustomHandler) as httpd:
        logging.info(f"Serving '{DIRECTORY}' directory at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logging.info("Shutting down server...")

if __name__ == "__main__":
    start_server()
