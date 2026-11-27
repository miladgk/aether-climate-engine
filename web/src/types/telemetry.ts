export type StationId = 'Berlin' | 'Tokyo' | 'New York' | 'London' | 'Sydney' | 'Helsinki';

export type SingleForecastModel = 'linear' | 'sma' | 'ema';
export type ForecastModel = SingleForecastModel | 'ensemble';
export type HorizonHours = 12 | 24 | 48;
export type TempUnit = 'C' | 'F';
export type WindUnit = 'kmh' | 'ms';
export type ThemeMode = 'default' | 'nord' | 'stone';

export interface ChartReferenceLine {
  id: string;
  value: number;
  label: string;
  tone: 'freeze' | 'yoy' | 'wind';
  align: 'left' | 'right';
}

export interface TelemetryRecord {
  time: string;
  temperature_2m: number;
  wind_speed_10m: number;
  location?: string;
  period?: 'live' | 'historical' | string;
}

export interface PredictionRecord {
  time: string;
  predicted_temperature_2m: number;
  predicted_wind_speed_10m: number;
  method?: SingleForecastModel | string;
  location?: string;
}

export interface ModelMae {
  temp_mae: number;
  wind_mae: number;
  n: number;
}

export interface StationSummaryEntry {
  utc_offset_seconds: number;
  /** IANA time zone, e.g. "Europe/Berlin". */
  timezone: string;
  /** Abbreviation Open-Meteo reports for the station, e.g. "GMT+1". */
  timezone_abbreviation: string;
  /** How many hourly observations the pipeline kept for this station. */
  observed_hours: number;
  /** Station-local wall-clock time of the last real observation. */
  observed_until: string;
  holdout_hours: number;
  holdout_mae: Partial<Record<SingleForecastModel, ModelMae>>;
  /** Grid-cell coordinates and elevation returned by Open-Meteo (newer pipeline runs only). */
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

export interface StationSummaryFile {
  /** When the pipeline produced this snapshot (UTC, ISO 8601). */
  generated_at_utc?: string;
  stations?: Record<string, StationSummaryEntry>;
}

export interface StationMetadata {
  id: StationId;
  shortLabel: string;
  fullName: string;
  /** Requested coordinates from config.json; used until the summary carries Open-Meteo's own. */
  latitude: number;
  longitude: number;
  /** Fallback elevation (m) until the summary carries Open-Meteo's own. */
  elevation: number;
}

export const STATION_ORDER: readonly StationId[] = [
  'Berlin',
  'Tokyo',
  'New York',
  'London',
  'Sydney',
  'Helsinki',
] as const;

export const STATION_META: Record<StationId, StationMetadata> = {
  Berlin: { id: 'Berlin', shortLabel: 'Berlin, DE', fullName: 'Berlin, Germany', latitude: 52.52, longitude: 13.41, elevation: 34 },
  Tokyo: { id: 'Tokyo', shortLabel: 'Tokyo, JP', fullName: 'Tokyo, Japan', latitude: 35.68, longitude: 139.69, elevation: 40 },
  'New York': { id: 'New York', shortLabel: 'New York, US', fullName: 'New York, USA', latitude: 40.71, longitude: -74.0, elevation: 10 },
  London: { id: 'London', shortLabel: 'London, UK', fullName: 'London, UK', latitude: 51.5, longitude: -0.12, elevation: 11 },
  Sydney: { id: 'Sydney', shortLabel: 'Sydney, AU', fullName: 'Sydney, Australia', latitude: -33.86, longitude: 151.2, elevation: 19 },
  Helsinki: { id: 'Helsinki', shortLabel: 'Helsinki, FI', fullName: 'Helsinki, Finland', latitude: 60.17, longitude: 24.94, elevation: 26 },
};

export interface LiveLatestReading {
  temperature_2m: number | null;
  wind_speed_10m: number | null;
  time?: string;
  timezone?: string;
  utc_offset_seconds?: number;
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

export interface LiveLatestFile {
  generated_at_utc: string;
  readings: Record<string, LiveLatestReading>;
}

export interface UnitPreferences {
  temp: TempUnit;
  wind: WindUnit;
}

export interface StationCardSummary {
  id: StationId;
  tempDisplay: string;
  windDisplay: string;
  yoyDelta: number | null;
  yoyLabel: string;
  yoyTone: 'pos' | 'neg' | 'neut';
  isMaxAnomaly: boolean;
  isMinAnomaly: boolean;
  /** The station's current local time right now, e.g. "22:00 CET" (a live clock, not data). */
  localTimeLabel: string;
  /** Whether it is night at the station right now (19:00–05:59 local). */
  isNight: boolean;
  sparklineValues: number[];
  coordsLabel: string;
}

export interface ForecastSeries {
  fTemp: (number | null)[];
  fWind: (number | null)[];
}

export interface EnsembleSeries {
  linear: ForecastSeries;
  sma: ForecastSeries;
  ema: ForecastSeries;
}

export type ObservationStatus = 'normal' | 'elevated' | 'severe' | 'freeze';

export type SpreadSeverity = 'low' | 'moderate' | 'high';

export interface ObservationTapeRow {
  timestamp: string;
  tempDisplay: string;
  windDisplay: string;
  status: ObservationStatus;
  statusLabel: string;
  statusReason: string;
}

export interface NightBand {
  startIndex: number;
  endIndex: number;
}

export interface HoldoutBreakdownRow {
  model: SingleForecastModel;
  label: string;
  tempMae: number;
  tempMaeDisplay: string;
  tempRatio: number;
  tempMarginDisplay: string;
  windMae: number;
  windMaeDisplay: string;
  windRatio: number;
  isWinner: boolean;
  /** Number of hourly points the MAE was scored on. */
  n: number;
}

export interface EnsembleSpreadSummary {
  tempAtHorizon: number;
  tempAtHorizonC: number;
  tempPeak: number;
  windAtHorizon: number;
  tempReadout: string;
  windReadout: string;
  severity: SpreadSeverity;
  severityLabel: string;
  detailTitle: string;
}

export interface StationViewData {
  labels: string[];
  slotTimestampsMs: number[];
  nightBands: NightBand[];
  temps: (number | null)[];
  winds: (number | null)[];
  histTemps: (number | null)[];
  histWinds: (number | null)[];
  primarySeries: ForecastSeries;
  ensembleSeries: EnsembleSeries | null;
  obsHours: number;
  horizon: HorizonHours;
  nowIndex: number;
  tzLabel: string;
  latestTemp: number | null;
  latestWind: number | null;
  latestWindKmh: number;
  beaufort: string;
  tempDeltaDisplay: string;
  tempDeltaTone: 'pos' | 'neg' | 'neut';
  windDeltaDisplay: string;
  windDeltaTone: 'pos' | 'neg' | 'neut';
  forecastPeakDisplay: string;
  tempMaeDisplay: string;
  windMaeDisplay: string;
  maeSourceModel: SingleForecastModel | null;
  holdoutHours: number;
  holdoutBreakdown: HoldoutBreakdownRow[];
  ensembleSpread: EnsembleSpreadSummary | null;
  winnerModel: SingleForecastModel | null;
  winnerBannerText: string;
  winnerBannerTitle: string;
  recentObservations: ObservationTapeRow[];
  provenance: StationProvenance;
}

/** Where the active station's numbers come from, straight from station_summary.json. */
export interface StationProvenance {
  timezone: string | null;
  timezoneAbbreviation: string | null;
  observedUntilLabel: string | null;
  observedHours: number | null;
  coordsLabel: string;
  coordsSource: 'open-meteo' | 'config';
  holdoutPoints: number | null;
}

export type DataFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface DataAgeSummary {
  freshness: DataFreshness;
  /** e.g. "Data as of Nov 18, 16:02" in the viewer's own time zone. */
  label: string;
  /** e.g. "21h ago". */
  ageLabel: string;
  /** Full explanation for the tooltip. */
  detail: string;
}
