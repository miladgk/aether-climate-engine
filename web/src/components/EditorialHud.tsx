import { useEffect, useRef, useState } from 'react';
import {
  ForecastModel,
  HorizonHours,
  STATION_META,
  StationId,
  StationViewData,
  UnitPreferences,
} from '../types/telemetry';

interface EditorialHudProps {
  station: StationId;
  model: ForecastModel;
  horizon: HorizonHours;
  units: UnitPreferences;
  viewData: StationViewData | null;
  localTimeLabel?: string;
  isNight?: boolean;
  onSelectModel?: (model: ForecastModel) => void;
}

export function EditorialHud({
  station,
  model,
  horizon,
  units,
  viewData,
  localTimeLabel,
  isNight = false,
  onSelectModel,
}: EditorialHudProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!breakdownOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBreakdownOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(e.target as Node)) {
        setBreakdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [breakdownOpen]);

  const meta = STATION_META[station];
  const tempUnitLabel = units.temp === 'C' ? '°C' : '°F';
  const windUnitLabel = units.wind === 'kmh' ? 'km/h' : 'm/s';

  const latestTempStr =
    viewData && viewData.latestTemp !== null ? viewData.latestTemp.toFixed(1) : '--';
  const latestWindStr =
    viewData && viewData.latestWind !== null ? viewData.latestWind.toFixed(1) : '--';

  const maeTag = viewData?.maeSourceModel
    ? viewData.maeSourceModel.toUpperCase()
    : 'MAE';
  const hasBreakdown = (viewData?.holdoutBreakdown.length ?? 0) > 0;
  const prov = viewData?.provenance;
  // Show one sample size in the subtitle when every model was scored on the same hours.
  const uniformN =
    !!viewData &&
    viewData.holdoutBreakdown.every((r) => r.n === viewData.holdoutBreakdown[0]?.n);
  const coordsLabel = prov?.coordsLabel ?? '';
  const coordsTitle =
    prov?.coordsSource === 'open-meteo'
      ? 'Grid-cell coordinates and elevation reported by Open-Meteo'
      : 'Coordinates requested in config.json';

  return (
    <div ref={shellRef} className="editorial-hud-shell">
      <aside className="editorial-hud" aria-label="Active Station Telemetry">
        <div
          key={`header-${station}`}
          className="hud-station-header hud-fade-in"
        >
          <div className="hud-kicker-row">
            <div className="hud-kicker">Active Station Telemetry</div>
            {localTimeLabel && (
              <span
                className={`st-clock-pill ${isNight ? 'night' : 'day'}`}
                title={`Current local time in ${meta.fullName}${prov?.timezone ? ` (${prov.timezone})` : ''}`}
              >
                <span className="st-solar-glyph" aria-hidden="true">
                  {isNight ? '☾' : '☀'}
                </span>
                <span>{localTimeLabel}</span>
              </span>
            )}
          </div>
          <h1 className="hud-city-title">{meta.fullName}</h1>
          <div className="hud-coords-sub" title={coordsTitle}>{coordsLabel}</div>
          {prov && (prov.observedUntilLabel || prov.observedHours !== null) && (
            <div
              className="hud-provenance"
              title="From station_summary.json: the last real observation (in Central European Time), how many hourly observations the pipeline kept, and the station's time zone"
            >
              {prov.observedUntilLabel && (
                <span className="hud-prov-item">
                  Last obs <strong>{prov.observedUntilLabel}</strong>
                </span>
              )}
              {prov.observedHours !== null && (
                <span className="hud-prov-item">
                  <strong>{prov.observedHours}h</strong> observed
                </span>
              )}
              {prov.timezone && <span className="hud-prov-item">{prov.timezone}</span>}
            </div>
          )}
        </div>

        <div
          key={`gauges-${station}`}
          className="primary-gauges hud-fade-in-delayed"
        >
            <div className="gauge-block">
              <div className="gauge-label">
                <span>2m Air Temperature</span>
                <span style={{ color: 'var(--amber)' }}>{horizon}h Forecast</span>
              </div>
              <div className="gauge-value-row">
                <div className="gauge-reading">
                  <span className="gauge-giant">{latestTempStr}</span>
                  <span className="gauge-unit">{tempUnitLabel}</span>
                </div>
                <div className={`delta-pill ${viewData?.tempDeltaTone ?? 'neut'}`}>
                  {viewData?.tempDeltaDisplay ?? '— vs YoY −1yr'}
                </div>
              </div>
            </div>

            <div className="gauge-block">
              <div className="gauge-label">
                <span>10m Surface Wind</span>
                <span style={{ color: 'var(--wind-blue)' }}>
                  {viewData?.beaufort ?? 'Light Breeze'}
                </span>
              </div>
              <div className="gauge-value-row">
                <div className="gauge-reading">
                  <span className="gauge-giant">{latestWindStr}</span>
                  <span className="gauge-unit">{windUnitLabel}</span>
                </div>
                <div className={`delta-pill ${viewData?.windDeltaTone ?? 'neut'}`}>
                  {viewData?.windDeltaDisplay ?? '— vs YoY −1yr'}
                </div>
            </div>
          </div>
        </div>

        <div className="hud-benchmark">
          <div className="bench-title">
            <span>Forecast Horizon Diagnostics</span>
            <span style={{ color: 'var(--amber)' }}>{model.toUpperCase()}</span>
          </div>
          <div className="bench-grid">
            <div className="bench-cell">
              <span className="bench-lbl">HORIZON SPAN</span>
              <span className="bench-val">+{horizon} Hours</span>
            </div>
            <div className="bench-cell">
              <span className="bench-lbl">TEMP FORECAST PEAK</span>
              <span className="bench-val">{viewData?.forecastPeakDisplay ?? '—'}</span>
            </div>
            <div
              className="bench-cell"
              title={
                model === 'ensemble' && viewData?.maeSourceModel
                  ? `Showing best holdout model (${maeTag}) temperature MAE; click winner banner to compare all 3`
                  : `${maeTag} temperature holdout MAE`
              }
            >
              <span className="bench-lbl">TEMP MAE · {maeTag}</span>
              <span className="bench-val" style={{ color: 'var(--forecast-green)' }}>
                {viewData?.tempMaeDisplay ?? '—'}
              </span>
            </div>
            <div
              className="bench-cell"
              title={
                model === 'ensemble' && viewData?.maeSourceModel
                  ? `Showing best holdout model (${maeTag}) wind MAE; click winner banner to compare all 3`
                  : `${maeTag} wind holdout MAE`
              }
            >
              <span className="bench-lbl">WIND MAE · {maeTag}</span>
              <span className="bench-val" style={{ color: 'var(--wind-blue)' }}>
                {viewData?.windMaeDisplay ?? '—'}
              </span>
            </div>
          </div>

          {model === 'ensemble' && viewData?.ensembleSpread && (
            <div
              className={`spread-strip spread-${viewData.ensembleSpread.severity}`}
              data-severity={viewData.ensembleSpread.severity}
              title={viewData.ensembleSpread.detailTitle}
            >
              <span className="spread-lbl-wrap">
                <span className="spread-dot" aria-hidden="true" />
                <span className="spread-lbl">MODEL SPREAD</span>
              </span>
              <span className="spread-val">{viewData.ensembleSpread.tempReadout}</span>
            </div>
          )}

          <button
            type="button"
            className={`bench-winner bench-winner-btn ${breakdownOpen ? 'open' : ''}`}
            title={
              hasBreakdown
                ? `${viewData?.winnerBannerTitle ?? 'Holdout ranking'} — Click to inspect all 3 models`
                : viewData?.winnerBannerTitle ?? 'Holdout ranking'
            }
            aria-expanded={breakdownOpen}
            disabled={!hasBreakdown}
            onClick={() => setBreakdownOpen((prev) => !prev)}
          >
            <span className="bench-winner-text">
              {viewData?.winnerBannerText ?? '★ Computing holdout ranking…'}
            </span>
            {hasBreakdown && (
              <span className="bench-chevron" aria-hidden="true">
                {breakdownOpen ? '▾' : '▴'}
              </span>
            )}
          </button>
        </div>
      </aside>

      {breakdownOpen && viewData && viewData.holdoutBreakdown.length > 0 && (
        <div
          className="mae-popover"
          role="dialog"
          aria-label={`Holdout MAE Breakdown for ${meta.fullName}`}
        >
          <div className="mae-popover-header">
            <div>
              <div className="mae-popover-title">Holdout MAE Breakdown</div>
              <div className="mae-popover-sub">
                {meta.shortLabel} · Last {viewData.holdoutHours}h backtest
                {uniformN
                  ? ` · n = ${viewData.holdoutBreakdown[0].n} hourly points per model`
                  : ' · sample size differs per model'}
              </div>
            </div>
            <button
              type="button"
              className="drawer-close"
              onClick={() => setBreakdownOpen(false)}
              aria-label="Close holdout breakdown"
            >
              ✕
            </button>
          </div>

          <div className="mae-matrix">
            {viewData.holdoutBreakdown.map((row) => {
              const isSelected = model === row.model;
              return (
                <button
                  key={row.model}
                  type="button"
                  className={`mae-row ${row.isWinner ? 'winner' : ''} ${
                    isSelected ? 'selected' : ''
                  }`}
                  onClick={() => onSelectModel?.(row.model)}
                  title={`Inspect ${row.label} forecast on charts`}
                >
                  <div className="mae-row-head">
                    <span className="mae-model-name">
                      {row.model.toUpperCase()}
                      {row.isWinner && (
                        <span className="mae-win-star" aria-label="Winner">
                          {' '}
                          ★
                        </span>
                      )}
                    </span>
                    <span className="mae-head-right">
                      {!uniformN && (
                        <span className="mae-n" title="Hourly points this MAE was scored on">
                          n={row.n}
                        </span>
                      )}
                      <span className={`mae-margin ${row.isWinner ? 'best' : ''}`}>
                        {row.tempMarginDisplay}
                      </span>
                    </span>
                  </div>

                  <div className="mae-bars">
                    <div className="mae-bar-line">
                      <span className="mae-bar-key">Temp</span>
                      <div className="mae-track">
                        <div
                          className={`mae-fill ${row.isWinner ? 'win' : 'temp'}`}
                          style={{ width: `${Math.round(row.tempRatio * 100)}%` }}
                        />
                      </div>
                      <span className="mae-bar-num">{row.tempMaeDisplay}</span>
                    </div>

                    <div className="mae-bar-line">
                      <span className="mae-bar-key">Wind</span>
                      <div className="mae-track">
                        <div
                          className="mae-fill wind"
                          style={{ width: `${Math.round(row.windRatio * 100)}%` }}
                        />
                      </div>
                      <span className="mae-bar-num">{row.windMaeDisplay}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {onSelectModel && model !== 'ensemble' && (
            <button
              type="button"
              className="mae-reset-ensemble"
              onClick={() => onSelectModel('ensemble')}
            >
              Return to Compare All 3 (Ensemble)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
