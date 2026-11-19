import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtmoBackdrop } from './components/AtmoBackdrop';
import { EditorialHud } from './components/EditorialHud';
import { HorizonCharts } from './components/HorizonCharts';
import { ShortcutsModal } from './components/ShortcutsModal';
import { StationDeck } from './components/StationDeck';
import { TactileDock } from './components/TactileDock';
import { TelemetryDrawer } from './components/TelemetryDrawer';
import {
  ForecastModel,
  HorizonHours,
  PredictionRecord,
  STATION_ORDER,
  StationId,
  StationSummaryEntry,
  StationSummaryFile,
  TelemetryRecord,
  ThemeMode,
  UnitPreferences,
} from './types/telemetry';
import {
  nextForecastModel,
  nextHorizon,
  nextTheme,
  parseObservatoryQuery,
  serializeObservatoryQuery,
} from './utils/observatoryState';
import {
  buildStationViewData,
  computeStationDeckData,
  parseNdjson,
  summarizeDataAge,
} from './utils/telemetry';

const TELEMETRY_URL = './sample_telemetry.json';
const PREDICTIONS_URL = './predictions.json';
const SUMMARY_URL = './station_summary.json';

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export default function App() {
  const [initialUrlState] = useState(() =>
    parseObservatoryQuery(typeof window !== 'undefined' ? window.location.search : ''),
  );

  const [liveRecords, setLiveRecords] = useState<TelemetryRecord[]>([]);
  const [predRecords, setPredRecords] = useState<PredictionRecord[]>([]);
  const [stationSummary, setStationSummary] = useState<Record<string, StationSummaryEntry>>({});
  const [generatedAtUtc, setGeneratedAtUtc] = useState<string | undefined>(undefined);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeStation, setActiveStation] = useState<StationId>(initialUrlState.station);
  const [model, setModel] = useState<ForecastModel>(initialUrlState.model);
  const [horizon, setHorizon] = useState<HorizonHours>(initialUrlState.horizon);
  const [units, setUnits] = useState<UnitPreferences>(initialUrlState.units);
  const [theme, setTheme] = useState<ThemeMode>(initialUrlState.theme);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);

  const loadTelemetry = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [liveRes, predRes, summaryRes] = await Promise.all([
        fetch(TELEMETRY_URL),
        fetch(PREDICTIONS_URL).catch(() => null),
        fetch(SUMMARY_URL).catch(() => null),
      ]);

      if (!liveRes.ok) {
        throw new Error(`Telemetry feed returned ${liveRes.status}`);
      }

      let summaryMap: Record<string, StationSummaryEntry> = {};
      let generatedAt: string | undefined;
      if (summaryRes && summaryRes.ok) {
        try {
          const parsedSummary = (await summaryRes.json()) as StationSummaryFile;
          summaryMap = parsedSummary.stations ?? {};
          generatedAt = parsedSummary.generated_at_utc;
        } catch {
          summaryMap = {};
        }
      }

      const rawLive = parseNdjson<TelemetryRecord>(await liveRes.text());
      const rawPred =
        predRes && predRes.ok
          ? parseNdjson<PredictionRecord>(await predRes.text())
          : [];

      // Timestamps are used exactly as the pipeline wrote them (station-local wall
      // clock). They are not shifted to "now": the header says how old the data is.
      setStationSummary(summaryMap);
      setGeneratedAtUtc(generatedAt);
      setLiveRecords(rawLive);
      setPredRecords(rawPred);
      setNowTick(Date.now());
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load planetary telemetry datasets.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry]);

  // Keep the "N hours ago" label honest while the tab stays open.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const dataAge = useMemo(
    () => summarizeDataAge(generatedAtUtc, new Date(nowTick)),
    [generatedAtUtc, nowTick],
  );

  useEffect(() => {
    const attrVal = theme === 'default' ? '' : theme;
    document.documentElement.setAttribute('data-theme', attrVal);
  }, [theme]);

  // Reflect active observatory configuration into shareable URL query string
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextQuery = serializeObservatoryQuery({
      station: activeStation,
      model,
      horizon,
      units,
      theme,
    });
    if (window.location.search !== nextQuery) {
      const nextUrl = `${window.location.pathname}${nextQuery}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeStation, model, horizon, units, theme]);

  // Re-hydrate state if browser history changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const parsed = parseObservatoryQuery(window.location.search);
      setActiveStation(parsed.station);
      setModel(parsed.model);
      setHorizon(parsed.horizon);
      setUnits(parsed.units);
      setTheme(parsed.theme);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Global keyboard instrument shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableEventTarget(e.target)) return;

      if (e.key === 'Escape') {
        if (shortcutsOpen) {
          e.preventDefault();
          setShortcutsOpen(false);
          return;
        }
        if (drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      // Pause instrument shortcuts while the shortcut reference modal is open
      if (shortcutsOpen) return;

      if (e.key >= '1' && e.key <= '5') {
        const station = STATION_ORDER[Number(e.key) - 1];
        if (station) {
          e.preventDefault();
          setActiveStation(station);
        }
        return;
      }

      const lower = e.key.toLowerCase();
      if (lower === 'm') {
        e.preventDefault();
        setModel((prev) => nextForecastModel(prev));
      } else if (lower === 'h') {
        e.preventDefault();
        setHorizon((prev) => nextHorizon(prev));
      } else if (lower === 'o') {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
      } else if (lower === 'u') {
        e.preventDefault();
        setUnits((prev) => ({ ...prev, temp: prev.temp === 'C' ? 'F' : 'C' }));
      } else if (lower === 'w') {
        e.preventDefault();
        setUnits((prev) => ({ ...prev, wind: prev.wind === 'kmh' ? 'ms' : 'kmh' }));
      } else if (lower === 't') {
        e.preventDefault();
        setTheme((prev) => nextTheme(prev));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsOpen, drawerOpen]);

  const deckCards = useMemo(
    () => computeStationDeckData(liveRecords, units, stationSummary, new Date(nowTick)),
    [liveRecords, units, stationSummary, nowTick],
  );

  const viewData = useMemo(
    () =>
      buildStationViewData({
        liveRecords,
        predRecords,
        stationSummary,
        location: activeStation,
        model,
        horizon,
        units,
      }),
    [liveRecords, predRecords, stationSummary, activeStation, model, horizon, units],
  );

  const obsHours = horizon * 2;
  const observationCount = viewData?.recentObservations.length ?? 15;

  return (
    <>
      <AtmoBackdrop
        windSpeedKmh={viewData?.latestWindKmh ?? 6.0}
        theme={theme}
      />

      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="load-logo">
            Ae<em>th</em>er
          </div>
          <div className="load-bar-wrap">
            <div className="load-bar" />
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              color: 'var(--muted)',
              letterSpacing: '0.1em',
            }}
          >
            SYNCHRONIZING PLANETARY TELEMETRY...
          </div>
        </div>
      )}

      <div className="observatory">
        <header className="top-ribbon">
          <div className="brand-lockup">
            <div className="wordmark">
              Ae<em>th</em>er
            </div>
            <span className="brand-subtitle">
              Planetary Climate &amp; Time-Series Intelligence
            </span>
          </div>

          <div className="telemetry-pills">
            <div className="status-badge">
              <span className="pulse-led" aria-hidden="true" />
              <span>
                Edge Telemetry Stream · {obsHours}h Observed + {horizon}h Horizon
              </span>
            </div>
            <div
              className={`status-badge data-age data-age-${dataAge.freshness}`}
              data-freshness={dataAge.freshness}
              title={dataAge.detail}
            >
              <span className="pulse-led" aria-hidden="true" />
              <span>{dataAge.label}</span>
              {dataAge.ageLabel && <span className="data-age-rel">· {dataAge.ageLabel}</span>}
            </div>
            <button
              type="button"
              className="drawer-toggle"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              <span>▤ Live Observation Tape ({observationCount})</span>
            </button>
            <button
              type="button"
              className="shortcut-trigger"
              aria-label="Keyboard shortcuts (?)"
              title="Keyboard shortcuts (?)"
              aria-expanded={shortcutsOpen}
              onClick={() => setShortcutsOpen((prev) => !prev)}
            >
              ?
            </button>
          </div>
        </header>

        {errorMessage ? (
          <div
            style={{
              padding: '24px',
              borderRadius: '16px',
              background: 'var(--bg-glass-strong)',
              border: '1px solid var(--border-active)',
              fontFamily: 'var(--mono)',
              fontSize: '12px',
            }}
          >
            <div style={{ color: 'var(--yoy-rose)', marginBottom: '10px' }}>
              Telemetry Synchronization Fault: {errorMessage}
            </div>
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => void loadTelemetry()}
            >
              Retry Telemetry Sync
            </button>
          </div>
        ) : (
          <>
            <StationDeck
              cards={deckCards}
              activeStation={activeStation}
              onSelectStation={setActiveStation}
            />

            <main className="horizon-workspace">
              <EditorialHud
                station={activeStation}
                model={model}
                horizon={horizon}
                units={units}
                viewData={viewData}
                localTimeLabel={deckCards.find((c) => c.id === activeStation)?.localTimeLabel}
                isNight={deckCards.find((c) => c.id === activeStation)?.isNight}
                onSelectModel={setModel}
              />

              <HorizonCharts
                viewData={viewData}
                model={model}
                units={units}
                theme={theme}
              />
            </main>

            <TactileDock
              model={model}
              winnerModel={viewData?.winnerModel ?? null}
              horizon={horizon}
              units={units}
              theme={theme}
              onChangeModel={setModel}
              onChangeHorizon={setHorizon}
              onChangeTempUnit={(temp) => setUnits((u) => ({ ...u, temp }))}
              onChangeWindUnit={(wind) => setUnits((u) => ({ ...u, wind }))}
              onChangeTheme={setTheme}
            />
          </>
        )}
      </div>

      <TelemetryDrawer
        open={drawerOpen}
        station={activeStation}
        model={model}
        horizon={horizon}
        units={units}
        viewData={viewData}
        generatedAtUtc={generatedAtUtc}
        rows={viewData?.recentObservations ?? []}
        onClose={() => setDrawerOpen(false)}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}

