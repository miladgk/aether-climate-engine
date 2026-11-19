import { useEffect, useRef, useState } from 'react';
import {
  ForecastModel,
  HorizonHours,
  ObservationTapeRow,
  STATION_META,
  StationId,
  StationViewData,
  UnitPreferences,
} from '../types/telemetry';
import { buildCsvFilename, buildStationTelemetryCsv } from '../utils/observatoryState';

interface TelemetryDrawerProps {
  open: boolean;
  station: StationId;
  model: ForecastModel;
  horizon: HorizonHours;
  units: UnitPreferences;
  viewData: StationViewData | null;
  generatedAtUtc?: string;
  rows: ObservationTapeRow[];
  onClose: () => void;
}

export function TelemetryDrawer({
  open,
  station,
  model,
  horizon,
  units,
  viewData,
  generatedAtUtc,
  rows,
  onClose,
}: TelemetryDrawerProps) {
  const [exported, setExported] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setExported(false);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, [station, model, horizon, units.temp, units.wind]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleExportCsv = () => {
    if (!viewData || viewData.labels.length === 0) return;

    const csv = buildStationTelemetryCsv({
      station,
      model,
      viewData,
      units,
      generatedAtUtc,
    });
    const filename = buildCsvFilename(station, model, horizon);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExported(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setExported(false);
      resetTimerRef.current = null;
    }, 2200);
  };

  const totalHours = viewData?.labels.length ?? 0;

  return (
    <aside
      className={`telemetry-drawer ${open ? 'open' : ''}`}
      aria-label="Recent Station Observations"
      aria-hidden={!open}
    >
      <div className="drawer-header">
        <div>
          <div className="drawer-title">Recent Station Observations</div>
          <div className="drawer-subtitle">
            {STATION_META[station].fullName}
            {viewData?.provenance.timezone && ` · ${viewData.provenance.timezone}`}
          </div>
        </div>
        <button type="button" className="drawer-close" onClick={onClose}>
          ESC / Close ✕
        </button>
      </div>
      <div className="drawer-legend" aria-label="Observation status color key">
        <span className="drawer-leg-item">
          <span className="feed-dot normal" aria-hidden="true" />
          Normal
        </span>
        <span className="drawer-leg-item">
          <span className="feed-dot elevated" aria-hidden="true" />
          Elevated
        </span>
        <span className="drawer-leg-item">
          <span className="feed-dot severe" aria-hidden="true" />
          Severe
        </span>
        <span className="drawer-leg-item">
          <span className="feed-dot freeze" aria-hidden="true" />
          {units.temp === 'C' ? '≤0°C' : '≤32°F'}
        </span>
      </div>
      <div className="feed-list">
        {rows.map((row) => (
          <div
            key={row.timestamp}
            className="feed-row"
            title={row.statusReason}
            data-status={row.status}
          >
            <span className="feed-time">{row.timestamp}</span>
            <span className="feed-temp">{row.tempDisplay}</span>
            <span className="feed-wind">{row.windDisplay}</span>
            <span
              className={`feed-dot ${row.status}`}
              title={row.statusReason}
              aria-label={`${row.statusLabel}: ${row.statusReason}`}
            />
          </div>
        ))}
      </div>
      <div className="drawer-footer">
        <div className="drawer-export-meta">
          <span className="drawer-export-label">Full Window Snapshot</span>
          <span className="drawer-export-detail">
            {totalHours}h · {model.toUpperCase()} · °{units.temp} /{' '}
            {units.wind === 'kmh' ? 'km/h' : 'm/s'}
          </span>
        </div>
        <button
          type="button"
          className={`drawer-export-btn ${exported ? 'exported' : ''}`}
          onClick={handleExportCsv}
          disabled={totalHours === 0}
        >
          {exported ? '✓ Exported CSV' : '↓ Export CSV'}
        </button>
      </div>
    </aside>
  );
}

