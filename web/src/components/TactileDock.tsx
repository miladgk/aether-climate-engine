import {
  ForecastModel,
  HorizonHours,
  SingleForecastModel,
  TempUnit,
  ThemeMode,
  UnitPreferences,
  WindUnit,
} from '../types/telemetry';

interface TactileDockProps {
  model: ForecastModel;
  winnerModel: SingleForecastModel | null;
  horizon: HorizonHours;
  units: UnitPreferences;
  theme: ThemeMode;
  onChangeModel: (model: ForecastModel) => void;
  onChangeHorizon: (horizon: HorizonHours) => void;
  onChangeTempUnit: (unit: TempUnit) => void;
  onChangeWindUnit: (unit: WindUnit) => void;
  onChangeTheme: (theme: ThemeMode) => void;
}

const MODEL_OPTIONS: { id: ForecastModel; label: string; shortLabel: string }[] = [
  { id: 'linear', label: 'Linear Regression', shortLabel: 'Linear' },
  { id: 'sma', label: 'Simple Moving Avg', shortLabel: 'SMA' },
  { id: 'ema', label: 'Exponential Smooth', shortLabel: 'EMA' },
  { id: 'ensemble', label: 'Compare All 3', shortLabel: 'All 3' },
];

const HORIZON_OPTIONS: HorizonHours[] = [12, 24, 48];

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'default', label: 'Ember' },
  { id: 'nord', label: 'Nord' },
  { id: 'stone', label: 'Stone' },
];

export function TactileDock({
  model,
  winnerModel,
  horizon,
  units,
  theme,
  onChangeModel,
  onChangeHorizon,
  onChangeTempUnit,
  onChangeWindUnit,
  onChangeTheme,
}: TactileDockProps) {
  return (
    <footer className="tactile-dock" aria-label="Observatory Instrument Controls">
      <div className="dock-group">
        <span className="dock-label">Forecast Model</span>
        <div className="seg-control" role="group" aria-label="Forecast Model">
          {MODEL_OPTIONS.map((opt) => {
            const isActive = model === opt.id;
            const isWinner = winnerModel !== null && opt.id === winnerModel;
            return (
              <button
                key={opt.id}
                type="button"
                className={`dock-btn ${isActive ? 'active' : ''}`}
                aria-pressed={isActive}
                title={opt.label}
                onClick={() => onChangeModel(opt.id)}
              >
                <span className="btn-label-full">{opt.label}</span>
                <span className="btn-label-short" aria-hidden="true">
                  {opt.shortLabel}
                </span>
                {isWinner && (
                  <span className="win-star" aria-label="Best holdout model">
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dock-divider" aria-hidden="true" />

      <div className="dock-group">
        <span className="dock-label">Horizon</span>
        <div className="seg-control" role="group" aria-label="Forecast Horizon">
          {HORIZON_OPTIONS.map((h) => {
            const isActive = horizon === h;
            return (
              <button
                key={h}
                type="button"
                className={`dock-btn ${isActive ? 'active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onChangeHorizon(h)}
              >
                {h}h
              </button>
            );
          })}
        </div>
      </div>

      <div className="dock-divider" aria-hidden="true" />

      <div className="dock-group">
        <span className="dock-label">Units</span>
        <div className="seg-control" role="group" aria-label="Temperature Unit">
          <button
            type="button"
            className={`dock-btn ${units.temp === 'C' ? 'active' : ''}`}
            aria-pressed={units.temp === 'C'}
            onClick={() => onChangeTempUnit('C')}
          >
            °C
          </button>
          <button
            type="button"
            className={`dock-btn ${units.temp === 'F' ? 'active' : ''}`}
            aria-pressed={units.temp === 'F'}
            onClick={() => onChangeTempUnit('F')}
          >
            °F
          </button>
        </div>
        <div className="seg-control" role="group" aria-label="Wind Speed Unit">
          <button
            type="button"
            className={`dock-btn ${units.wind === 'kmh' ? 'active' : ''}`}
            aria-pressed={units.wind === 'kmh'}
            onClick={() => onChangeWindUnit('kmh')}
          >
            km/h
          </button>
          <button
            type="button"
            className={`dock-btn ${units.wind === 'ms' ? 'active' : ''}`}
            aria-pressed={units.wind === 'ms'}
            onClick={() => onChangeWindUnit('ms')}
          >
            m/s
          </button>
        </div>
      </div>

      <div className="dock-divider" aria-hidden="true" />

      <div className="dock-group">
        <span className="dock-label">Atmosphere</span>
        <div className="seg-control" role="group" aria-label="Atmosphere Theme">
          {THEME_OPTIONS.map((opt) => {
            const isActive = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`dock-btn ${isActive ? 'active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onChangeTheme(opt.id)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
