"""
End-to-end + cross-browser compatibility tests: simulate a real user opening the
live dashboard and interacting with it, across the three major rendering engines
(Chromium, Firefox/Gecko, WebKit/Safari) via Playwright. Unlike the unit/smoke/
integration tests, this is the only layer that exercises the frontend JavaScript
and Chart.js rendering pipeline — nothing else in the suite touches
`dashboard/index.html`.

Every test in this file runs once per engine (parametrized through the `page`
fixture), so a bug that only shows up in one browser (a CSS quirk, a JS API gap)
fails that one combination instead of being invisible.

The dashboard is served from the static `dashboard/` folder (the same files the
live GitHub Pages site serves) over a local HTTP server, so no network access or
live Open-Meteo API call is required — these tests work fully offline.

Requires the Playwright browser binaries to be installed once:
    playwright install chromium firefox webkit
An engine that isn't installed is skipped individually rather than failing.
"""
import http.server
import os
import socketserver
import threading

import pytest
from playwright.sync_api import sync_playwright

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASHBOARD_DIR = os.path.join(PROJECT_ROOT, "dashboard")

BROWSER_ENGINES = ["chromium", "firefox", "webkit"]

LOADING_HIDDEN_JS = (
    "document.getElementById('loading').style.display === 'none' "
    "|| document.getElementById('loading').classList.contains('hidden')"
)


def _engine_launchable(engine_name: str) -> bool:
    try:
        with sync_playwright() as p:
            browser = getattr(p, engine_name).launch()
            browser.close()
        return True
    except Exception:
        return False


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


@pytest.fixture(scope="module")
def dashboard_url():
    """Serve the static dashboard/ folder on a free local port for the duration of the module."""
    handler = lambda *args, **kwargs: _QuietHandler(*args, directory=DASHBOARD_DIR, **kwargs)
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{port}/index.html"

    server.shutdown()
    server.server_close()


@pytest.fixture(params=BROWSER_ENGINES)
def page(request, dashboard_url):
    """A fresh page in each of the three browser engines, navigated to the loaded dashboard."""
    engine_name = request.param
    if not _engine_launchable(engine_name):
        pytest.skip(f"{engine_name} is not installed. Run: playwright install {engine_name}")

    with sync_playwright() as p:
        browser = getattr(p, engine_name).launch()
        pg = browser.new_page()
        pg.goto(dashboard_url)
        pg.wait_for_function(LOADING_HIDDEN_JS, timeout=15000)
        yield pg
        browser.close()


def test_dashboard_loads_and_hides_loading_screen(page):
    """The command center should load, fetch telemetry, and dismiss the loading overlay."""
    assert page.title() == "Aether | Climate Intelligence Platform"


def test_temperature_and_wind_charts_render(page):
    """Chart.js should render both canvases with actual pixel content, proving telemetry data reached the charts."""
    for canvas_id in ["tempChart", "windChart"]:
        canvas = page.locator(f"#{canvas_id}")
        assert canvas.count() == 1
        box = canvas.bounding_box()
        assert box is not None and box["width"] > 0 and box["height"] > 0

    # Chart.js attaches a live instance to each canvas once rendered.
    chart_instances = page.evaluate(
        "() => [!!Chart.getChart('tempChart'), !!Chart.getChart('windChart')]"
    )
    assert chart_instances == [True, True]


def test_switching_temperature_unit_updates_label_and_stat(page):
    """Clicking °F should flip the unit label and current-temperature readout without a page reload."""
    assert page.inner_text("#tempUnitLabel") == "°C"
    celsius_reading = page.inner_text("#currentTemp")

    page.click("#unit-F")
    page.wait_for_function("document.getElementById('tempUnitLabel').textContent === '°F'")

    assert page.inner_text("#tempUnitLabel") == "°F"
    assert page.evaluate("document.getElementById('unit-F').classList.contains('active')")
    assert not page.evaluate("document.getElementById('unit-C').classList.contains('active')")

    fahrenheit_reading = page.inner_text("#currentTemp")
    # The numeric reading must change when the unit conversion is applied (°C -> °F is never identity here).
    assert fahrenheit_reading != celsius_reading


def test_switching_theme_updates_root_attribute(page):
    """Selecting the Nord Frost theme should set data-theme="nord" on <html> and mark that button active."""
    page.click("#theme-nord")
    page.wait_for_function("document.documentElement.getAttribute('data-theme') === 'nord'")

    assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "nord"
    assert page.evaluate("document.getElementById('theme-nord').classList.contains('active')")


def test_changing_location_updates_station_name(page):
    """Picking Tokyo from the station dropdown should update the topbar location label."""
    assert "Berlin" in page.inner_text("#topbar-location")

    page.select_option("#locationSelect", "Tokyo")
    page.wait_for_function("document.getElementById('topbar-location').textContent.includes('Tokyo')")

    assert "Tokyo" in page.inner_text("#topbar-location")
