"""
End-to-end + cross-browser compatibility tests: simulate a real user opening the
dashboard and interacting with it, across the three major rendering engines
(Chromium, Firefox/Gecko, WebKit/Safari) via Playwright. Unlike the unit/smoke/
integration tests, this is the only Python layer that exercises the built React
UI (web/) and its Chart.js rendering. Pure UI logic is unit-tested separately
with `cd web && npm test`.

Every test in this file runs once per engine (parametrized through the `page`
fixture), so a bug that only shows up in one browser fails that one combination
instead of being invisible.

The page is served exactly the way GitHub Pages and scripts/serve_dashboard.py
serve it: the built UI from web/dist/ plus the pipeline's JSON from docs/. No
network access or live Open-Meteo call is needed.

Requires the UI to be built and the Playwright browsers installed once:
    cd web && npm ci && npm run build
    playwright install chromium firefox webkit
If web/dist/ is missing the module is skipped; an engine that isn't installed
is skipped individually.
"""
import json
import os
import re
import socketserver
import sys
import threading

import pytest
from playwright.sync_api import sync_playwright

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))
from serve_dashboard import DIST_DIR, DashboardHandler  # noqa: E402

BROWSER_ENGINES = ["chromium", "firefox", "webkit"]

with open(os.path.join(PROJECT_ROOT, "docs", "station_summary.json")) as _f:
    SUMMARY = json.load(_f)

pytestmark = pytest.mark.skipif(
    not os.path.exists(os.path.join(DIST_DIR, "index.html")),
    reason="web/dist is not built. Run: cd web && npm ci && npm run build",
)


def _engine_launchable(engine_name: str) -> bool:
    try:
        with sync_playwright() as p:
            browser = getattr(p, engine_name).launch()
            browser.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def dashboard_url():
    """Serve web/dist + docs/*.json on a free local port for the duration of the module."""
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", 0), DashboardHandler)
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
        pg = browser.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(dashboard_url)
        pg.wait_for_selector(".loading-overlay", state="detached", timeout=15000)
        pg.wait_for_selector(".station-card[data-loc='Berlin']", timeout=15000)
        yield pg
        browser.close()


def test_dashboard_loads_and_hides_loading_screen(page):
    """The observatory should load, fetch telemetry, and dismiss the loading overlay."""
    assert page.title().startswith("Aether")
    assert page.locator(".station-card").count() == 5


def test_temperature_and_wind_charts_render(page):
    """Both canvases should be laid out and actually painted, proving telemetry reached the charts."""
    for label in ["Temperature chart", "Wind speed chart"]:
        canvas = page.locator(f"canvas[aria-label^='{label}']")
        assert canvas.count() == 1
        box = canvas.bounding_box()
        assert box is not None and box["width"] > 0 and box["height"] > 0

    painted = page.evaluate(
        """() => [...document.querySelectorAll('canvas[aria-label]')].map((c) => {
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
            return false;
        })"""
    )
    assert painted == [True, True]


def test_switching_temperature_unit_updates_label_and_stat(page):
    """Clicking °F should flip the unit label and current-temperature readout without a page reload."""
    unit = page.locator(".gauge-unit").first
    reading = page.locator(".gauge-giant").first
    assert unit.inner_text() == "°C"
    celsius_reading = reading.inner_text()

    group = page.get_by_role("group", name="Temperature Unit")
    group.get_by_role("button", name="°F").click()
    page.wait_for_function("document.querySelector('.gauge-unit').textContent === '°F'")

    assert group.get_by_role("button", name="°F").get_attribute("aria-pressed") == "true"
    assert group.get_by_role("button", name="°C").get_attribute("aria-pressed") == "false"
    assert reading.inner_text() != celsius_reading
    assert "temp=F" in page.url


def test_switching_theme_updates_root_attribute(page):
    """Selecting the Nord theme should set data-theme="nord" on <html> and mark that button pressed."""
    group = page.get_by_role("group", name="Atmosphere Theme")
    group.get_by_role("button", name="Nord").click()
    page.wait_for_function("document.documentElement.getAttribute('data-theme') === 'nord'")

    assert group.get_by_role("button", name="Nord").get_attribute("aria-pressed") == "true"


def test_changing_location_updates_station_name(page):
    """Clicking the Tokyo station card should update the active-station title and time zone."""
    assert "Berlin" in page.inner_text(".hud-city-title")

    page.click(".station-card[data-loc='Tokyo']")
    page.wait_for_function("document.querySelector('.hud-city-title').textContent.includes('Tokyo')")

    assert page.get_attribute(".station-card[data-loc='Tokyo']", "aria-pressed") == "true"
    assert SUMMARY["stations"]["Tokyo"]["timezone"] in page.inner_text(".hud-provenance")


def test_header_shows_snapshot_age_not_page_load_time(page):
    """The header badge reports generated_at_utc from the pipeline, never 'Synced <now>'."""
    badge = page.locator(".data-age")
    assert badge.count() == 1
    assert badge.get_attribute("data-freshness") in {"fresh", "aging", "stale"}
    assert badge.inner_text().startswith("Data as of")
    generated = SUMMARY["generated_at_utc"]  # e.g. 2026-11-18T16:02:17Z
    assert f"{generated[:10]} {generated[11:16]} UTC" in badge.get_attribute("title")
    assert "Synced" not in page.inner_text("header")


def test_station_clocks_are_live_and_data_times_are_cet(page):
    """Cards show each station's current local time with day/night; data times are in CET."""
    for name in SUMMARY["stations"]:
        pill = page.locator(f".station-card[data-loc='{name}'] .st-clock-pill")
        assert re.fullmatch(r"[☀☾]\s*\d{2}:\d{2} \S+", pill.inner_text().strip())
        assert re.search(r"\b(day|night)\b", pill.get_attribute("class"))
    berlin_pill = page.inner_text(".station-card[data-loc='Berlin'] .st-clock-pill")
    assert re.search(r"\bCES?T\b", berlin_pill)

    berlin = SUMMARY["stations"]["Berlin"]
    provenance = page.inner_text(".hud-provenance")
    assert re.search(r"\bCES?T\b", provenance)
    assert f"{berlin['observed_hours']}h" in provenance
    assert re.search(r"\(CES?T\)", page.locator(".horizon-range-badge").first.inner_text())
