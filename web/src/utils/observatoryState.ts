import {
  ForecastModel,
  HorizonHours,
  STATION_ORDER,
  StationId,
  StationViewData,
  TempUnit,
  ThemeMode,
  UnitPreferences,
  WindUnit,
} from '../types/telemetry';

export interface ObservatoryUrlState {
  station: StationId;
  model: ForecastModel;
  horizon: HorizonHours;
  units: UnitPreferences;
  theme: ThemeMode;
}

export const DEFAULT_OBSERVATORY_STATE: ObservatoryUrlState = {
  station: 'Berlin',
  model: 'ensemble',
  horizon: 48,
  units: { temp: 'C', wind: 'kmh' },
  theme: 'default',
};

const MODEL_CYCLE: readonly ForecastModel[] = ['linear', 'sma', 'ema', 'ensemble'] as const;
const HORIZON_CYCLE: readonly HorizonHours[] = [12, 24, 48] as const;
const THEME_CYCLE: readonly ThemeMode[] = ['default', 'nord', 'stone'] as const;

export function nextForecastModel(current: ForecastModel): ForecastModel {
  const idx = MODEL_CYCLE.indexOf(current);
  return MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length];
}

export function nextHorizon(current: HorizonHours): HorizonHours {
  const idx = HORIZON_CYCLE.indexOf(current);
  return HORIZON_CYCLE[(idx + 1) % HORIZON_CYCLE.length];
}

export function nextTheme(current: ThemeMode): ThemeMode {
  const idx = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

export function parseObservatoryQuery(search: string): ObservatoryUrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);

  // Station (case-insensitive)
  const rawStation = params.get('station')?.trim().toLowerCase();
  const matchedStation =
    STATION_ORDER.find((s) => s.toLowerCase() === rawStation) ??
    DEFAULT_OBSERVATORY_STATE.station;

  // Model
  const rawModel = params.get('model')?.trim().toLowerCase();
  const matchedModel: ForecastModel =
    rawModel === 'linear' ||
    rawModel === 'sma' ||
    rawModel === 'ema' ||
    rawModel === 'ensemble'
      ? rawModel
      : DEFAULT_OBSERVATORY_STATE.model;

  // Horizon
  const rawHorizon = Number(params.get('horizon'));
  const matchedHorizon: HorizonHours =
    rawHorizon === 12 || rawHorizon === 24 || rawHorizon === 48
      ? rawHorizon
      : DEFAULT_OBSERVATORY_STATE.horizon;

  // Units
  const rawTemp = params.get('temp')?.trim().toUpperCase();
  const matchedTemp: TempUnit =
    rawTemp === 'C' || rawTemp === 'F' ? rawTemp : DEFAULT_OBSERVATORY_STATE.units.temp;

  const rawWind = params.get('wind')?.trim().toLowerCase();
  const matchedWind: WindUnit =
    rawWind === 'kmh' || rawWind === 'ms'
      ? rawWind
      : DEFAULT_OBSERVATORY_STATE.units.wind;

  // Theme (supports both 'ember' and 'default')
  const rawTheme = params.get('theme')?.trim().toLowerCase();
  let matchedTheme: ThemeMode = DEFAULT_OBSERVATORY_STATE.theme;
  if (rawTheme === 'nord' || rawTheme === 'stone') {
    matchedTheme = rawTheme;
  } else if (rawTheme === 'ember' || rawTheme === 'default') {
    matchedTheme = 'default';
  }

  return {
    station: matchedStation,
    model: matchedModel,
    horizon: matchedHorizon,
    units: { temp: matchedTemp, wind: matchedWind },
    theme: matchedTheme,
  };
}

export function serializeObservatoryQuery(state: ObservatoryUrlState): string {
  const params = new URLSearchParams();
  params.set('station', state.station);
  params.set('model', state.model);
  params.set('horizon', String(state.horizon));
  params.set('temp', state.units.temp);
  params.set('wind', state.units.wind);
  params.set('theme', state.theme === 'default' ? 'ember' : state.theme);
  return `?${params.toString()}`;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatNumCell(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

export function buildCsvFilename(
  station: StationId,
  model: ForecastModel,
  horizon: HorizonHours,
): string {
  const slug = station.toLowerCase().replace(/\s+/g, '-');
  return `aether-${slug}-${model}-${horizon}h.csv`;
}

export function buildStationTelemetryCsv(params: {
  station: StationId;
  model: ForecastModel;
  viewData: StationViewData;
  units: UnitPreferences;
  /** Pipeline snapshot time; when given, every row records it so exports stay traceable. */
  generatedAtUtc?: string;
}): string {
  const { station, model, viewData, units, generatedAtUtc } = params;
  const tUnit = units.temp === 'C' ? 'C' : 'F';
  const wUnit = units.wind === 'kmh' ? 'kmh' : 'ms';
  const isEnsemble = model === 'ensemble' && viewData.ensembleSeries !== null;

  const headers = isEnsemble
    ? [
        'station',
        'local_time',
        'timezone',
        'phase',
        `observed_temp_${tUnit}`,
        `linear_temp_${tUnit}`,
        `sma_temp_${tUnit}`,
        `ema_temp_${tUnit}`,
        `yoy_temp_${tUnit}`,
        `observed_wind_${wUnit}`,
        `linear_wind_${wUnit}`,
        `sma_wind_${wUnit}`,
        `ema_wind_${wUnit}`,
        `yoy_wind_${wUnit}`,
      ]
    : [
        'station',
        'local_time',
        'timezone',
        'phase',
        `observed_temp_${tUnit}`,
        `forecast_${model}_temp_${tUnit}`,
        `yoy_temp_${tUnit}`,
        `observed_wind_${wUnit}`,
        `forecast_${model}_wind_${wUnit}`,
        `yoy_wind_${wUnit}`,
      ];

  if (generatedAtUtc) headers.push('snapshot_generated_utc');
  const tail = generatedAtUtc ? [escapeCsvCell(generatedAtUtc)] : [];

  const rows: string[] = [headers.join(',')];

  for (let i = 0; i < viewData.labels.length; i++) {
    const phase =
      i < viewData.nowIndex
        ? 'observed'
        : i === viewData.nowIndex
          ? 'now'
          : 'forecast';

    const baseCols = [
      escapeCsvCell(station),
      escapeCsvCell(viewData.labels[i]),
      escapeCsvCell(viewData.tzLabel),
      phase,
    ];

    if (isEnsemble && viewData.ensembleSeries) {
      rows.push(
        [
          ...baseCols,
          formatNumCell(viewData.temps[i]),
          formatNumCell(viewData.ensembleSeries.linear.fTemp[i]),
          formatNumCell(viewData.ensembleSeries.sma.fTemp[i]),
          formatNumCell(viewData.ensembleSeries.ema.fTemp[i]),
          formatNumCell(viewData.histTemps[i]),
          formatNumCell(viewData.winds[i]),
          formatNumCell(viewData.ensembleSeries.linear.fWind[i]),
          formatNumCell(viewData.ensembleSeries.sma.fWind[i]),
          formatNumCell(viewData.ensembleSeries.ema.fWind[i]),
          formatNumCell(viewData.histWinds[i]),
          ...tail,
        ].join(','),
      );
    } else {
      rows.push(
        [
          ...baseCols,
          formatNumCell(viewData.temps[i]),
          formatNumCell(viewData.primarySeries.fTemp[i]),
          formatNumCell(viewData.histTemps[i]),
          formatNumCell(viewData.winds[i]),
          formatNumCell(viewData.primarySeries.fWind[i]),
          formatNumCell(viewData.histWinds[i]),
          ...tail,
        ].join(','),
      );
    }
  }

  return rows.join('\n');
}
