import {
  ChartReferenceLine,
  DataAgeSummary,
  DataFreshness,
  EnsembleSeries,
  EnsembleSpreadSummary,
  ForecastModel,
  ForecastSeries,
  HoldoutBreakdownRow,
  HorizonHours,
  NightBand,
  ObservationStatus,
  ObservationTapeRow,
  PredictionRecord,
  SingleForecastModel,
  SpreadSeverity,
  StationProvenance,
  STATION_META,
  STATION_ORDER,
  StationCardSummary,
  StationId,
  StationSummaryEntry,
  StationViewData,
  TelemetryRecord,
  TempUnit,
  UnitPreferences,
  WindUnit,
} from '../types/telemetry';

export const HOUR_MS = 3600000;

export function parseNdjson<T>(rawText: string): T[] {
  if (!rawText || !rawText.trim()) return [];
  const results: T[] = [];
  for (const line of rawText.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as T;
      if (parsed && typeof parsed === 'object') {
        results.push(parsed);
      }
    } catch {
      // Skip malformed NDJSON lines gracefully
    }
  }
  return results;
}

/**
 * Parses station-local wall-clock timestamps ("2026-11-18T14:00") as UTC instants
 * so formatting in timeZone 'UTC' always preserves station local wall-clock time.
 */
export function wallMs(timestamp: string): number {
  return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`);
}

export function fmtWall(ms: number): string {
  const d = new Date(ms);
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${datePart} ${timePart}`;
}

export function isNightHour(hour: number): boolean {
  return hour >= 19 || hour < 6;
}

export function formatStationLocalClock(
  timestamp: string,
  tzShort: string,
): { label: string; isNight: boolean } {
  const ms = wallMs(timestamp);
  if (!Number.isFinite(ms)) {
    return { label: `--:-- ${tzShort}`, isNight: false };
  }
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    label: `${hh}:${mm} ${tzShort}`,
    isNight: isNightHour(d.getUTCHours()),
  };
}

export function extractSparklineSeries(
  recs: readonly TelemetryRecord[],
  hours = 48,
): number[] {
  if (!recs.length) return [];
  return recs.slice(-hours).map((r) => r.temperature_2m);
}

export interface SparklineGeometry {
  linePath: string;
  areaPath: string;
  endX: number;
  endY: number;
}

export function buildSparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  padY = 2.5,
): SparklineGeometry | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usableH = Math.max(1, height - padY * 2);
  const stepX = width / (values.length - 1);

  const coords = values.map((v, idx) => {
    const x = idx * stepX;
    const norm = span === 0 ? 0.5 : (v - min) / span;
    const y = padY + (1 - norm) * usableH;
    return { x, y };
  });

  const linePath = coords
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)} ${height.toFixed(1)} L0 ${height.toFixed(1)} Z`;

  return {
    linePath,
    areaPath,
    endX: last.x,
    endY: last.y,
  };
}

export function convertTemp(tempC: number, unit: TempUnit): number {
  return unit === 'C' ? tempC : (tempC * 9) / 5 + 32;
}

export function convertTempDelta(deltaC: number, unit: TempUnit): number {
  return unit === 'C' ? deltaC : (deltaC * 9) / 5;
}

export function convertWind(windKmh: number, unit: WindUnit): number {
  return unit === 'kmh' ? windKmh : windKmh / 3.6;
}

export function beaufortLabel(kmh: number): string {
  if (kmh < 2) return 'Calm Air';
  if (kmh < 6) return 'Light Air';
  if (kmh < 12) return 'Light Breeze';
  if (kmh < 20) return 'Gentle Breeze';
  if (kmh < 29) return 'Moderate Breeze';
  return 'Fresh Wind';
}

export function observedFor(
  liveRecords: readonly TelemetryRecord[],
  location: string,
): TelemetryRecord[] {
  return liveRecords.filter(
    (r) => (r.location || 'Berlin') === location && r.period !== 'historical',
  );
}

const COORD_DIGITS = 2;

function formatLatLon(lat: number, lon: number, digits = COORD_DIGITS): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}°${ns} · ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

/**
 * Station coordinates: Open-Meteo's grid cell (with elevation) when the pipeline
 * recorded it, otherwise the coordinates requested in config.json.
 */
export function stationCoords(
  station: StationId,
  summary?: StationSummaryEntry,
): { label: string; source: 'open-meteo' | 'config' } {
  const lat = summary?.latitude;
  const lon = summary?.longitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    const elev =
      typeof summary?.elevation === 'number' ? ` · Elev ${Math.round(summary.elevation)}m` : '';
    return { label: `${formatLatLon(lat, lon)}${elev}`, source: 'open-meteo' };
  }
  const meta = STATION_META[station];
  return {
    label: `${formatLatLon(meta.latitude, meta.longitude)} · Elev ${meta.elevation}m`,
    source: 'config',
  };
}

/** All data timestamps on the page are shown in Central European Time. */
export const DISPLAY_TIME_ZONE = 'Europe/Berlin';

const ABBR_LOCALES = ['en-US', 'en-GB', 'en-AU', 'ja-JP'] as const;

/** Short zone name such as CET, JST, EST, GMT or AEDT (falls back to "GMT+9" style). */
export function tzAbbreviation(timeZone: string, at: Date = new Date()): string {
  let fallback = '';
  for (const locale of ABBR_LOCALES) {
    try {
      const name =
        new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
          .formatToParts(at)
          .find((part) => part.type === 'timeZoneName')?.value ?? '';
      if (!fallback) fallback = name;
      if (name && !/^(GMT|UTC)[+-−]/.test(name)) return name;
    } catch {
      return fallback || timeZone;
    }
  }
  return fallback || timeZone;
}

/** Station wall-clock ms (see wallMs) -> real UTC instant, using the station's UTC offset. */
export function wallToUtcMs(wall: number, summary?: StationSummaryEntry): number {
  return wall - (summary?.utc_offset_seconds ?? 0) * 1000;
}

/** "Nov 18 05:00 PM" in Central European Time for a real UTC instant. */
export function fmtDisplay(utcMs: number): string {
  const d = new Date(utcMs);
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_TIME_ZONE,
  });
  return `${datePart} ${timePart}`;
}

/**
 * The station's current local time and whether it is night there right now.
 * This is a live clock (from the viewer's clock and the station's time zone), not data.
 */
export function stationClockNow(
  summary: StationSummaryEntry | undefined,
  now: Date = new Date(),
): { label: string; isNight: boolean } {
  let hour: number;
  let minute: number;
  let abbr: string;
  try {
    if (!summary?.timezone) throw new Error('no tz');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: summary.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    hour = Number(parts.find((p) => p.type === 'hour')?.value);
    minute = Number(parts.find((p) => p.type === 'minute')?.value);
    abbr = tzAbbreviation(summary.timezone, now);
  } catch {
    const local = new Date(now.getTime() + (summary?.utc_offset_seconds ?? 0) * 1000);
    hour = local.getUTCHours();
    minute = local.getUTCMinutes();
    abbr = summary?.timezone_abbreviation || 'UTC';
  }
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return { label: `${hh}:${mm} ${abbr}`, isNight: isNightHour(hour) };
}

const HOUR_LABEL: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

/**
 * How old the pipeline snapshot is. The site is a static snapshot, so this is the
 * only honest answer to "when is this data from?" — it is never the page load time.
 */
export function summarizeDataAge(
  generatedAtUtc: string | undefined,
  now: Date = new Date(),
  timeZone: string = DISPLAY_TIME_ZONE,
): DataAgeSummary {
  const ms = generatedAtUtc ? Date.parse(generatedAtUtc) : NaN;
  if (!Number.isFinite(ms)) {
    return {
      freshness: 'unknown',
      label: 'Data time unknown',
      ageLabel: '',
      detail: 'station_summary.json has no generated_at_utc, so the snapshot time is unknown.',
    };
  }

  const ageH = Math.max(0, (now.getTime() - ms) / HOUR_MS);
  const ageLabel =
    ageH < 1 ? 'under 1h ago' : ageH < 48 ? `${Math.floor(ageH)}h ago` : `${Math.floor(ageH / 24)}d ago`;
  const freshness: DataFreshness = ageH < 26 ? 'fresh' : ageH < 72 ? 'aging' : 'stale';
  const d = new Date(ms);
  // Same zone as every other timestamp on the page (Central European Time by default).
  const local = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}, ${d.toLocaleTimeString('en-GB', { ...HOUR_LABEL, timeZone })} ${tzAbbreviation(timeZone, d)}`;
  const utc = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  return {
    freshness,
    label: `Data as of ${local}`,
    ageLabel,
    detail: `Pipeline snapshot generated ${utc} (${ageLabel}). This page is static: it shows that snapshot and is not a live feed.`,
  };
}

export function computeStationYoyDelta(
  liveRecords: readonly TelemetryRecord[],
  location: string,
  tempUnit: TempUnit,
): number | null {
  const obs = observedFor(liveRecords, location);
  const lastYear = liveRecords.filter(
    (r) => (r.location || 'Berlin') === location && r.period === 'historical',
  );
  if (!obs.length || !lastYear.length) return null;

  const latest = obs[obs.length - 1];
  const latestMs = wallMs(latest.time);
  let best: TelemetryRecord | null = null;
  let bestMs = -Infinity;

  for (const hr of lastYear) {
    const m = wallMs(hr.time);
    if (m <= latestMs && m > bestMs) {
      best = hr;
      bestMs = m;
    }
  }

  if (!best || latestMs - bestMs > 24 * HOUR_MS) return null;
  const deltaC = latest.temperature_2m - best.temperature_2m;
  return convertTempDelta(deltaC, tempUnit);
}

export function computeStationDeckData(
  liveRecords: readonly TelemetryRecord[],
  units: UnitPreferences,
  stationSummary: Record<string, StationSummaryEntry> = {},
  now: Date = new Date(),
): StationCardSummary[] {
  let maxPosLoc: StationId | null = null;
  let maxPos = 0;
  let minNegLoc: StationId | null = null;
  let minNeg = 0;

  const tempSuffix = `°${units.temp}`;
  const windSuffix = units.wind === 'kmh' ? 'km/h' : 'm/s';

  const intermediate = STATION_ORDER.map((loc) => {
    const summary = stationSummary[loc];
    const clock = stationClockNow(summary, now);
    const coordsLabel = stationCoords(loc, summary).label;
    const recs = observedFor(liveRecords, loc);
    if (!recs.length) {
      return {
        id: loc,
        tempDisplay: '--',
        windDisplay: `-- ${windSuffix}`,
        yoyDelta: null as number | null,
        yoyLabel: '— YoY',
        yoyTone: 'neut' as const,
        localTimeLabel: clock.label,
        isNight: clock.isNight,
        sparklineValues: [] as number[],
        coordsLabel,
      };
    }

    const latest = recs[recs.length - 1];
    const tVal = convertTemp(latest.temperature_2m, units.temp);
    const wVal = convertWind(latest.wind_speed_10m, units.wind);
    const delta = computeStationYoyDelta(liveRecords, loc, units.temp);
    const sparklineValues = extractSparklineSeries(recs, 48);

    let yoyLabel = '— YoY';
    let yoyTone: 'pos' | 'neg' | 'neut' = 'neut';
    if (delta !== null) {
      const sign = delta > 0 ? '+' : '';
      yoyLabel = `${sign}${delta.toFixed(1)}° YoY`;
      yoyTone = delta > 0.3 ? 'pos' : delta < -0.3 ? 'neg' : 'neut';
      // Scientifically accurate outlier gating:
      // Warm glow strictly requires delta > 0; cool glow strictly requires delta < 0.
      if (delta > 0 && delta > maxPos) {
        maxPos = delta;
        maxPosLoc = loc;
      }
      if (delta < 0 && delta < minNeg) {
        minNeg = delta;
        minNegLoc = loc;
      }
    }

    return {
      id: loc,
      tempDisplay: `${tVal.toFixed(1)}${tempSuffix}`,
      windDisplay: `${wVal.toFixed(1)} ${windSuffix}`,
      yoyDelta: delta,
      yoyLabel,
      yoyTone,
      localTimeLabel: clock.label,
      isNight: clock.isNight,
      sparklineValues,
      coordsLabel,
    };
  });

  return intermediate.map((item) => ({
    ...item,
    isMaxAnomaly: maxPosLoc !== null && item.id === maxPosLoc,
    isMinAnomaly: minNegLoc !== null && item.id === minNegLoc,
  }));
}

export function buildEnsembleFan(
  seriesA: readonly (number | null)[],
  seriesB: readonly (number | null)[],
  seriesC: readonly (number | null)[],
): { upper: (number | null)[]; lower: (number | null)[] } {
  return buildDynamicEnsembleFan([seriesA, seriesB, seriesC], seriesA.length);
}

/**
 * Computes per-hour min/max bounds across any subset of currently visible forecast series.
 */
export function buildDynamicEnsembleFan(
  seriesList: readonly (readonly (number | null)[])[],
  length: number,
): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < length; i++) {
    const vals: number[] = [];
    for (const s of seriesList) {
      const v = s[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        vals.push(v);
      }
    }
    if (vals.length) {
      upper.push(Math.max(...vals));
      lower.push(Math.min(...vals));
    } else {
      upper.push(null);
      lower.push(null);
    }
  }

  return { upper, lower };
}

/**
 * Groups contiguous local nighttime hours (19:00–05:59 station wall-clock time)
 * into index ranges for subtle chart background shading.
 */
export function computeNightBands(slotTimestampsMs: readonly number[]): NightBand[] {
  const bands: NightBand[] = [];
  let activeStart: number | null = null;

  for (let i = 0; i < slotTimestampsMs.length; i++) {
    const hour = new Date(slotTimestampsMs[i]).getUTCHours();
    const isNight = hour >= 19 || hour < 6;

    if (isNight && activeStart === null) {
      activeStart = i;
    } else if (!isNight && activeStart !== null) {
      bands.push({ startIndex: activeStart, endIndex: i - 1 });
      activeStart = null;
    }
  }

  if (activeStart !== null && slotTimestampsMs.length > 0) {
    bands.push({ startIndex: activeStart, endIndex: slotTimestampsMs.length - 1 });
  }

  return bands;
}

export function findBestHoldoutModel(
  summary?: StationSummaryEntry,
): SingleForecastModel | null {
  const holdout = summary?.holdout_mae;
  if (!holdout) return null;

  const models: SingleForecastModel[] = ['linear', 'sma', 'ema'];
  let winner: SingleForecastModel | null = null;

  for (const m of models) {
    const entry = holdout[m];
    if (!entry) continue;
    if (!winner || entry.temp_mae < (holdout[winner]?.temp_mae ?? Infinity)) {
      winner = m;
    }
  }

  return winner;
}

const MODEL_LABELS: Record<SingleForecastModel, string> = {
  linear: 'Linear Regression',
  sma: 'Simple Moving Avg',
  ema: 'Exponential Smooth',
};

/**
 * Builds a side-by-side holdout MAE comparison matrix across Linear, SMA, and EMA
 * with proportional bar ratios and winner margin deltas.
 */
export function buildHoldoutBreakdown(
  summary: StationSummaryEntry | undefined,
  units: UnitPreferences,
): HoldoutBreakdownRow[] {
  const holdout = summary?.holdout_mae;
  if (!holdout) return [];

  const models: SingleForecastModel[] = ['linear', 'sma', 'ema'];
  const entries = models
    .map((m) => (holdout[m] ? { model: m, mae: holdout[m]! } : null))
    .filter((x): x is { model: SingleForecastModel; mae: { temp_mae: number; wind_mae: number; n: number } } => x !== null);

  if (!entries.length) return [];

  const winner = findBestHoldoutModel(summary);
  const bestTempC = winner && holdout[winner] ? holdout[winner]!.temp_mae : entries[0].mae.temp_mae;
  const maxTempC = Math.max(...entries.map((e) => e.mae.temp_mae), 0.001);
  const maxWindKmh = Math.max(...entries.map((e) => e.mae.wind_mae), 0.001);
  const windUnitStr = units.wind === 'kmh' ? 'km/h' : 'm/s';

  return entries
    .map(({ model, mae }) => {
      const tempVal = convertTempDelta(mae.temp_mae, units.temp);
      const windVal = convertWind(mae.wind_mae, units.wind);
      const marginVal = convertTempDelta(mae.temp_mae - bestTempC, units.temp);
      const isWinner = model === winner;

      return {
        model,
        label: MODEL_LABELS[model],
        tempMae: tempVal,
        tempMaeDisplay: `±${tempVal.toFixed(2)}°${units.temp}`,
        tempRatio: Math.max(0.08, Math.min(1, mae.temp_mae / maxTempC)),
        tempMarginDisplay: isWinner ? 'Best' : `+${marginVal.toFixed(2)}°${units.temp}`,
        windMae: windVal,
        windMaeDisplay: `±${windVal.toFixed(2)} ${windUnitStr}`,
        windRatio: Math.max(0.08, Math.min(1, mae.wind_mae / maxWindKmh)),
        isWinner,
        n: mae.n,
      };
    })
    .sort((a, b) => a.tempMae - b.tempMae);
}

export function classifySpreadSeverity(halfSpreadC: number): {
  severity: SpreadSeverity;
  label: string;
  description: string;
} {
  if (halfSpreadC < 1.0) {
    return {
      severity: 'low',
      label: 'High Agreement',
      description: 'Tight model convergence (< 1.0°C half-spread)',
    };
  }
  if (halfSpreadC <= 2.5) {
    return {
      severity: 'moderate',
      label: 'Moderate Spread',
      description: 'Moderate model divergence (1.0°C–2.5°C half-spread)',
    };
  }
  return {
    severity: 'high',
    label: 'High Divergence',
    description: 'High forecast uncertainty (> 2.5°C half-spread)',
  };
}

export function classifyObservationReading(params: {
  tempC: number;
  windKmh: number;
  histTempC: number | null;
  units: UnitPreferences;
}): {
  status: ObservationStatus;
  label: string;
  reason: string;
} {
  const { tempC, windKmh, histTempC, units } = params;
  const yoyDeltaC = histTempC !== null && Number.isFinite(histTempC) ? tempC - histTempC : null;
  const absYoyC = yoyDeltaC !== null ? Math.abs(yoyDeltaC) : 0;

  const tempVal = convertTemp(tempC, units.temp);
  const windVal = convertWind(windKmh, units.wind);
  const windUnitStr = units.wind === 'kmh' ? 'km/h' : 'm/s';
  const formatDelta = (deltaC: number) => {
    const converted = convertTempDelta(deltaC, units.temp);
    const sign = converted > 0 ? '+' : '';
    return `${sign}${converted.toFixed(1)}°${units.temp} vs YoY`;
  };

  if (tempC <= 0) {
    const notes = [`Freezing air (${tempVal.toFixed(1)}°${units.temp})`];
    if (windKmh >= 20) {
      notes.push(`${beaufortLabel(windKmh)} (${windVal.toFixed(1)} ${windUnitStr})`);
    }
    if (yoyDeltaC !== null && absYoyC >= 4.0) {
      notes.push(formatDelta(yoyDeltaC));
    }
    return {
      status: 'freeze',
      label: 'Freezing condition',
      reason: notes.join(' · '),
    };
  }

  const severeReasons: string[] = [];
  if (windKmh >= 29) {
    severeReasons.push(`Strong wind (${windVal.toFixed(1)} ${windUnitStr} · ${beaufortLabel(windKmh)})`);
  }
  if (yoyDeltaC !== null && absYoyC >= 8.0) {
    severeReasons.push(
      `Severe ${yoyDeltaC > 0 ? 'warm' : 'cold'} anomaly (${formatDelta(yoyDeltaC)})`,
    );
  }
  if (severeReasons.length > 0) {
    return {
      status: 'severe',
      label: 'Severe reading',
      reason: severeReasons.join(' · '),
    };
  }

  const elevatedReasons: string[] = [];
  if (windKmh >= 20) {
    elevatedReasons.push(`Brisk wind (${windVal.toFixed(1)} ${windUnitStr} · ${beaufortLabel(windKmh)})`);
  }
  if (yoyDeltaC !== null && absYoyC >= 4.0) {
    elevatedReasons.push(
      `Moderate ${yoyDeltaC > 0 ? 'warm' : 'cold'} anomaly (${formatDelta(yoyDeltaC)})`,
    );
  }
  if (elevatedReasons.length > 0) {
    return {
      status: 'elevated',
      label: 'Elevated reading',
      reason: elevatedReasons.join(' · '),
    };
  }

  const normalDetail =
    yoyDeltaC !== null
      ? `Nominal conditions (${formatDelta(yoyDeltaC)} · ${beaufortLabel(windKmh)})`
      : `Nominal conditions (${beaufortLabel(windKmh)})`;
  return {
    status: 'normal',
    label: 'Nominal reading',
    reason: normalDetail,
  };
}

/**
 * Computes model divergence (half-spread: (max - min) / 2) across Linear, SMA, and EMA
 * over the active forecast horizon.
 */
export function computeEnsembleSpread(
  ensembleSeries: EnsembleSeries,
  nowIndex: number,
  horizon: HorizonHours,
  units: UnitPreferences,
): EnsembleSpreadSummary | null {
  const endIndex = Math.min(
    ensembleSeries.linear.fTemp.length - 1,
    nowIndex + horizon,
  );

  let tempPeak = 0;
  let tempAtHorizon: number | null = null;
  let windAtHorizon: number | null = null;

  for (let i = nowIndex + 1; i <= endIndex; i++) {
    const tVals = [
      ensembleSeries.linear.fTemp[i],
      ensembleSeries.sma.fTemp[i],
      ensembleSeries.ema.fTemp[i],
    ].filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    if (tVals.length >= 2) {
      const halfSpread = (Math.max(...tVals) - Math.min(...tVals)) / 2;
      if (halfSpread > tempPeak) tempPeak = halfSpread;
      tempAtHorizon = halfSpread;
    }

    const wVals = [
      ensembleSeries.linear.fWind[i],
      ensembleSeries.sma.fWind[i],
      ensembleSeries.ema.fWind[i],
    ].filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    if (wVals.length >= 2) {
      windAtHorizon = (Math.max(...wVals) - Math.min(...wVals)) / 2;
    }
  }

  if (tempAtHorizon === null) return null;

  const tempAtHorizonC = units.temp === 'C' ? tempAtHorizon : tempAtHorizon / 1.8;
  const spreadClass = classifySpreadSeverity(tempAtHorizonC);
  const windSpread = windAtHorizon ?? 0;
  const windUnitStr = units.wind === 'kmh' ? 'km/h' : 'm/s';

  return {
    tempAtHorizon,
    tempAtHorizonC,
    tempPeak,
    windAtHorizon: windSpread,
    tempReadout: `±${tempAtHorizon.toFixed(1)}°${units.temp} at +${horizon}h`,
    windReadout: `±${windSpread.toFixed(1)} ${windUnitStr}`,
    severity: spreadClass.severity,
    severityLabel: spreadClass.label,
    detailTitle: `${spreadClass.label} — ${spreadClass.description}. Half-spread at +${horizon}h (peak ±${tempPeak.toFixed(1)}°${units.temp}, wind ±${windSpread.toFixed(1)} ${windUnitStr})`,
  };
}

export function buildStationViewData(params: {
  liveRecords: readonly TelemetryRecord[];
  predRecords: readonly PredictionRecord[];
  stationSummary: Record<string, StationSummaryEntry>;
  location: StationId;
  model: ForecastModel;
  horizon: HorizonHours;
  units: UnitPreferences;
}): StationViewData | null {
  const { liveRecords, predRecords, stationSummary, location, model, horizon, units } = params;

  const locLive = liveRecords.filter((r) => (r.location || 'Berlin') === location);
  const observedAll = locLive.filter((r) => r.period !== 'historical');
  const lastYear = locLive.filter((r) => r.period === 'historical');

  if (!observedAll.length) return null;

  const obsHours = horizon * 2;
  const totalHours = obsHours + horizon;
  const nowIndex = obsHours - 1;
  const nowMs = wallMs(observedAll[observedAll.length - 1].time);
  const startMs = nowMs - nowIndex * HOUR_MS;
  const slotOf = (t: string) => Math.round((wallMs(t) - startMs) / HOUR_MS);

  const currentYear = observedAll.filter((r) => {
    const i = slotOf(r.time);
    return i >= 0 && i <= nowIndex;
  });

  const primaryMethod: SingleForecastModel = model === 'ensemble' ? 'linear' : model;

  const summary = stationSummary[location];
  // Slots stay on the station's wall clock (night shading = night at the station);
  // every label is shown in Central European Time.
  const slotTimestampsMs = Array.from({ length: totalHours }, (_, i) => startMs + i * HOUR_MS);
  const labels = slotTimestampsMs.map((ms) => fmtDisplay(wallToUtcMs(ms, summary)));
  const nightBands = computeNightBands(slotTimestampsMs);
  const temps: (number | null)[] = Array(totalHours).fill(null);
  const winds: (number | null)[] = Array(totalHours).fill(null);
  const histTemps: (number | null)[] = Array(totalHours).fill(null);
  const histWinds: (number | null)[] = Array(totalHours).fill(null);

  for (const r of currentYear) {
    const i = slotOf(r.time);
    temps[i] = convertTemp(r.temperature_2m, units.temp);
    winds[i] = convertWind(r.wind_speed_10m, units.wind);
  }

  const buildForecastSeries = (methodName: SingleForecastModel): ForecastSeries => {
    const recs = predRecords.filter(
      (r) => (r.location || 'Berlin') === location && (r.method || 'linear') === methodName,
    );
    const fTemp: (number | null)[] = Array(totalHours).fill(null);
    const fWind: (number | null)[] = Array(totalHours).fill(null);

    if (recs.length) {
      fTemp[nowIndex] = temps[nowIndex];
      fWind[nowIndex] = winds[nowIndex];
    }

    for (const r of recs) {
      const i = slotOf(r.time);
      if (i <= nowIndex || i >= totalHours) continue;
      fTemp[i] = convertTemp(r.predicted_temperature_2m, units.temp);
      fWind[i] = convertWind(r.predicted_wind_speed_10m, units.wind);
    }

    return { fTemp, fWind };
  };

  const primarySeries = buildForecastSeries(primaryMethod);

  for (const hr of lastYear) {
    const i = slotOf(hr.time);
    if (i >= 0 && i < totalHours) {
      histTemps[i] = convertTemp(hr.temperature_2m, units.temp);
      histWinds[i] = convertWind(hr.wind_speed_10m, units.wind);
    }
  }

  const tzLabel = tzAbbreviation(DISPLAY_TIME_ZONE, new Date(wallToUtcMs(nowMs, summary)));
  const latestRaw = observedAll[observedAll.length - 1];
  const latestWindKmh = latestRaw.wind_speed_10m || 5.0;

  const latestTemp = temps[nowIndex];
  const latestWind = winds[nowIndex];
  const lastHistTemp = histTemps.slice(0, nowIndex + 1).filter((v): v is number => v !== null).pop();
  const lastHistWind = histWinds.slice(0, nowIndex + 1).filter((v): v is number => v !== null).pop();

  let tempDeltaDisplay = '— vs YoY −1yr';
  let tempDeltaTone: 'pos' | 'neg' | 'neut' = 'neut';
  if (lastHistTemp !== undefined && latestTemp !== null) {
    const deltaVal = latestTemp - lastHistTemp;
    const thresh = units.temp === 'C' ? 0.5 : 0.9;
    const sign = deltaVal > 0 ? '+' : '';
    tempDeltaDisplay = `${sign}${deltaVal.toFixed(1)}°${units.temp} vs YoY −1yr`;
    tempDeltaTone = deltaVal > thresh ? 'pos' : deltaVal < -thresh ? 'neg' : 'neut';
  }

  let windDeltaDisplay = '— vs YoY −1yr';
  let windDeltaTone: 'pos' | 'neg' | 'neut' = 'neut';
  const windUnitStr = units.wind === 'kmh' ? 'km/h' : 'm/s';
  if (lastHistWind !== undefined && latestWind !== null) {
    const deltaVal = latestWind - lastHistWind;
    const thresh = units.wind === 'kmh' ? 0.5 : 0.14;
    const sign = deltaVal > 0 ? '+' : '';
    windDeltaDisplay = `${sign}${deltaVal.toFixed(1)} ${windUnitStr} vs YoY −1yr`;
    windDeltaTone = deltaVal > thresh ? 'pos' : deltaVal < -thresh ? 'neg' : 'neut';
  }

  const ensembleSeries: EnsembleSeries | null =
    model === 'ensemble'
      ? {
          linear: buildForecastSeries('linear'),
          sma: buildForecastSeries('sma'),
          ema: buildForecastSeries('ema'),
        }
      : null;

  const ensembleSpread = ensembleSeries
    ? computeEnsembleSpread(ensembleSeries, nowIndex, horizon, units)
    : null;

  // In Ensemble mode, compute forecast peak envelope across all 3 models so it matches the shaded fan.
  const validPredTemps = ensembleSeries
    ? [
        ...ensembleSeries.linear.fTemp,
        ...ensembleSeries.sma.fTemp,
        ...ensembleSeries.ema.fTemp,
      ].filter((v): v is number => v !== null)
    : primarySeries.fTemp.filter((v): v is number => v !== null);

  const forecastPeakDisplay = validPredTemps.length
    ? `${Math.min(...validPredTemps).toFixed(1)}° → ${Math.max(...validPredTemps).toFixed(1)}°${units.temp}`
    : '—';

  const holdout = summary?.holdout_mae || {};
  const holdoutHours = summary?.holdout_hours || 24;
  const winnerModel = findBestHoldoutModel(summary);
  const holdoutBreakdown = buildHoldoutBreakdown(summary, units);

  // Clarify MAE source: in Ensemble mode attribute to the station's best holdout model;
  // in single-model mode attribute to the selected model.
  const maeSourceModel: SingleForecastModel | null =
    model === 'ensemble' ? (winnerModel ?? 'linear') : model;
  const activeMae = maeSourceModel ? holdout[maeSourceModel] : undefined;

  const tempMaeDisplay = activeMae
    ? `±${convertTempDelta(activeMae.temp_mae, units.temp).toFixed(2)} °${units.temp}`
    : '—';
  const windMaeDisplay = activeMae
    ? `±${convertWind(activeMae.wind_mae, units.wind).toFixed(2)} ${windUnitStr}`
    : '—';

  let winnerBannerText = '★ Holdout scores unavailable';
  let winnerBannerTitle = 'Holdout validation scores are not available for this station';
  if (winnerModel && holdout[winnerModel]) {
    const w = holdout[winnerModel]!.temp_mae;
    const wDisplay = convertTempDelta(w, units.temp);
    winnerBannerText = `★ Best in ${location}: ${winnerModel.toUpperCase()} (±${wDisplay.toFixed(2)}°${units.temp})`;
    winnerBannerTitle = `Lowest temperature MAE when forecasting the last ${holdoutHours} observed hours from the hours before them`;
  }

  const histTempCBySlot = new Map<number, number>();
  for (const hr of lastYear) {
    const i = slotOf(hr.time);
    if (i >= 0 && i < totalHours) {
      histTempCBySlot.set(i, hr.temperature_2m);
    }
  }

  const recentObservations: ObservationTapeRow[] = [...currentYear]
    .reverse()
    .slice(0, 15)
    .map((rec) => {
      const slot = slotOf(rec.time);
      const histTempC = histTempCBySlot.get(slot) ?? null;
      const classification = classifyObservationReading({
        tempC: rec.temperature_2m,
        windKmh: rec.wind_speed_10m,
        histTempC,
        units,
      });

      return {
        timestamp: fmtDisplay(wallToUtcMs(wallMs(rec.time), summary)),
        tempDisplay: `${convertTemp(rec.temperature_2m, units.temp).toFixed(1)}°${units.temp}`,
        windDisplay: `${convertWind(rec.wind_speed_10m, units.wind).toFixed(1)} ${windUnitStr}`,
        status: classification.status,
        statusLabel: classification.label,
        statusReason: classification.reason,
      };
    });

  const coords = stationCoords(location, summary);
  const holdoutPoints = winnerModel ? holdout[winnerModel]?.n ?? null : null;
  const provenance: StationProvenance = {
    timezone: summary?.timezone ?? null,
    timezoneAbbreviation: summary?.timezone_abbreviation ?? null,
    observedUntilLabel: summary?.observed_until
      ? `${fmtDisplay(wallToUtcMs(wallMs(summary.observed_until), summary))} ${tzLabel}`
      : null,
    observedHours: typeof summary?.observed_hours === 'number' ? summary.observed_hours : null,
    coordsLabel: coords.label,
    coordsSource: coords.source,
    holdoutPoints,
  };

  return {
    provenance,
    labels,
    slotTimestampsMs,
    nightBands,
    temps,
    winds,
    histTemps,
    histWinds,
    primarySeries,
    ensembleSeries,
    obsHours,
    horizon,
    nowIndex,
    tzLabel,
    latestTemp,
    latestWind,
    latestWindKmh,
    beaufort: beaufortLabel(latestWindKmh),
    tempDeltaDisplay,
    tempDeltaTone,
    windDeltaDisplay,
    windDeltaTone,
    forecastPeakDisplay,
    tempMaeDisplay,
    windMaeDisplay,
    maeSourceModel,
    holdoutHours,
    holdoutBreakdown,
    ensembleSpread,
    winnerModel,
    winnerBannerText,
    winnerBannerTitle,
    recentObservations,
  };
}

export function computeSeriesMean(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

export function buildTempReferenceLines(
  histTemps: readonly (number | null)[],
  tempUnit: TempUnit,
  includeYoyMean = true,
): ChartReferenceLine[] {
  const lines: ChartReferenceLine[] = [
    {
      id: 'freeze',
      value: tempUnit === 'C' ? 0 : 32,
      label: tempUnit === 'C' ? '0°C Freeze' : '32°F Freeze',
      tone: 'freeze',
      align: 'left',
    },
  ];

  if (includeYoyMean) {
    const yoyMean = computeSeriesMean(histTemps);
    if (yoyMean !== null) {
      lines.push({
        id: 'yoy-mean',
        value: yoyMean,
        label: `YoY Mean ${yoyMean.toFixed(1)}°${tempUnit}`,
        tone: 'yoy',
        align: 'right',
      });
    }
  }

  return lines;
}

export function buildWindReferenceLines(windUnit: WindUnit): ChartReferenceLine[] {
  const thresholdKmh = 20;
  const value = windUnit === 'kmh' ? thresholdKmh : Number((thresholdKmh / 3.6).toFixed(2));
  const label = windUnit === 'kmh' ? '20 km/h · Bft 4' : `${value.toFixed(1)} m/s · Bft 4`;

  return [
    {
      id: 'bft4',
      value,
      label,
      tone: 'wind',
      align: 'left',
    },
  ];
}

