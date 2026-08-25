import http.server
import socketserver
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

PORT = 8000
DIRECTORY = "dashboard"

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # Disable logging to avoid cluttering the test output
    def log_message(self, format, *args):
        pass

def start_server():
    if not os.path.exists(DIRECTORY):
        logging.error(f"Directory '{DIRECTORY}' does not exist.")
        sys.exit(1)
        
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        logging.info(f"Serving '{DIRECTORY}' directory at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logging.info("Shutting down server...")

if __name__ == "__main__":
    start_server()
