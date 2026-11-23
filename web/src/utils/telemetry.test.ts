import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  beaufortLabel,
  buildDynamicEnsembleFan,
  buildEnsembleFan,
  buildHoldoutBreakdown,
  buildSparklinePath,
  buildStationViewData,
  buildTempReferenceLines,
  buildWindReferenceLines,
  classifyObservationReading,
  classifySpreadSeverity,
  computeEnsembleSpread,
  computeNightBands,
  computeSeriesMean,
  computeStationDeckData,
  computeStationYoyDelta,
  convertTemp,
  convertTempDelta,
  convertWind,
  extractSparklineSeries,
  findBestHoldoutModel,
  fmtWall,
  formatStationLocalClock,
  HOUR_MS,
  fmtDisplay,
  stationClockNow,
  stationCoords,
  summarizeDataAge,
  tzAbbreviation,
  wallToUtcMs,
  parseNdjson,
  wallMs,
} from './telemetry';
import {
  PredictionRecord,
  StationSummaryEntry,
  StationSummaryFile,
  TelemetryRecord,
} from '../types/telemetry';

test('parseNdjson parses valid lines and skips empty or malformed lines', () => {
  const input = `
{"time":"2026-11-18T12:00","temperature_2m":10.5,"wind_speed_10m":5.2,"location":"Berlin"}
not-valid-json
{"time":"2026-11-18T13:00","temperature_2m":11.0,"wind_speed_10m":6.0,"location":"Berlin"}
`;
  const parsed = parseNdjson<TelemetryRecord>(input);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].temperature_2m, 10.5);
  assert.equal(parsed[1].wind_speed_10m, 6.0);
});

test('unit conversions and Beaufort wind classification are accurate', () => {
  assert.equal(convertTemp(0, 'C'), 0);
  assert.equal(convertTemp(0, 'F'), 32);
  assert.equal(convertTemp(100, 'F'), 212);
  assert.equal(convertTempDelta(5, 'F'), 9);
  assert.ok(Math.abs(convertWind(36, 'ms') - 10) < 1e-9);
  assert.equal(convertWind(14.5, 'kmh'), 14.5);

  assert.equal(beaufortLabel(1.2), 'Calm Air');
  assert.equal(beaufortLabel(4.5), 'Light Air');
  assert.equal(beaufortLabel(9.0), 'Light Breeze');
  assert.equal(beaufortLabel(15.0), 'Gentle Breeze');
  assert.equal(beaufortLabel(24.0), 'Moderate Breeze');
  assert.equal(beaufortLabel(35.0), 'Fresh Wind');
});

test('wallMs and fmtWall preserve station-local wall-clock time regardless of viewer timezone', () => {
  const ms = wallMs('2026-11-18T14:00');
  assert.equal(ms, Date.UTC(2026, 10, 18, 14, 0, 0));
  const formatted = fmtWall(ms);
  assert.match(formatted, /Nov 18/);
  assert.match(formatted, /02:00 PM|14:00/);
});

test('summarizeDataAge reports the pipeline snapshot time and grades its age', () => {
  const generated = '2026-11-18T16:02:17Z';
  const fresh = summarizeDataAge(generated, new Date('2026-11-19T04:00:00Z'), 'UTC');
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.label, 'Data as of Nov 18, 16:02 UTC');
  assert.equal(fresh.ageLabel, '11h ago');
  assert.match(fresh.detail, /2026-11-18 16:02 UTC/);
  assert.match(fresh.detail, /not a live feed/);

  assert.equal(summarizeDataAge(generated, new Date('2026-11-20T04:00:00Z')).freshness, 'aging');
  const stale = summarizeDataAge(generated, new Date('2026-11-25T16:02:17Z'));
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.ageLabel, '7d ago');

  const unknown = summarizeDataAge(undefined);
  assert.equal(unknown.freshness, 'unknown');
  assert.equal(unknown.ageLabel, '');
});

test('stationCoords prefers Open-Meteo grid coordinates and falls back to config.json', () => {
  const base = {
    utc_offset_seconds: 32400,
    timezone: 'Asia/Tokyo',
    timezone_abbreviation: 'GMT+9',
    observed_hours: 96,
    observed_until: '2026-11-19T01:00',
    holdout_hours: 24,
    holdout_mae: {},
  };
  assert.deepEqual(stationCoords('Tokyo', base), {
    label: '35.68°N · 139.69°E · Elev 40m',
    source: 'config',
  });
  assert.deepEqual(
    stationCoords('Tokyo', { ...base, latitude: 35.7, longitude: 139.6875, elevation: 40.4 }),
    { label: '35.70°N · 139.69°E · Elev 40m', source: 'open-meteo' },
  );
  assert.equal(stationCoords('Sydney').label, '33.86°S · 151.20°E · Elev 19m');
  assert.equal(stationCoords('New York').label, '40.71°N · 74.00°W · Elev 10m');
});

test('tzAbbreviation prefers familiar short names', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(tzAbbreviation('Europe/Berlin', winter), 'CET');
  assert.equal(tzAbbreviation('Europe/Berlin', summer), 'CEST');
  assert.equal(tzAbbreviation('Asia/Tokyo', winter), 'JST');
  assert.equal(tzAbbreviation('America/New_York', winter), 'EST');
  assert.equal(tzAbbreviation('Europe/London', winter), 'GMT');
  assert.equal(tzAbbreviation('Australia/Sydney', winter), 'AEDT');
});

test('stationClockNow is a live clock: current station-local time and day/night right now', () => {
  const tokyo = {
    utc_offset_seconds: 32400,
    timezone: 'Asia/Tokyo',
    timezone_abbreviation: 'GMT+9',
    observed_hours: 96,
    observed_until: '2026-11-19T01:00',
    holdout_hours: 24,
    holdout_mae: {},
  };
  // 21:28 UTC = 06:28 next morning in Tokyo
  assert.deepEqual(stationClockNow(tokyo, new Date('2026-11-19T21:28:00Z')), {
    label: '06:28 JST',
    isNight: false,
  });
  // 13:05 UTC = 22:05 in Tokyo
  assert.deepEqual(stationClockNow(tokyo, new Date('2026-11-19T13:05:00Z')), {
    label: '22:05 JST',
    isNight: true,
  });
  // Without an IANA zone it falls back to the numeric offset
  assert.deepEqual(
    stationClockNow({ ...tokyo, timezone: '' }, new Date('2026-11-19T13:05:00Z')),
    { label: '22:05 GMT+9', isNight: true },
  );
});

test('fmtDisplay shows real instants in Central European Time', () => {
  // Tokyo wall clock 2026-11-19 01:00 (UTC+9) = 2026-11-18 16:00 UTC = 17:00 CET
  const utc = wallToUtcMs(wallMs('2026-11-19T01:00'), {
    utc_offset_seconds: 32400,
  } as StationSummaryEntry);
  assert.equal(fmtDisplay(utc), 'Nov 18 05:00 PM');
});

test('buildEnsembleFan and buildDynamicEnsembleFan compute bounds for active series subsets', () => {
  const fan = buildEnsembleFan(
    [null, 10, 14, null],
    [null, 12, 11, 8],
    [null, 9, 13, null],
  );
  assert.deepEqual(fan.upper, [null, 12, 14, 8]);
  assert.deepEqual(fan.lower, [null, 9, 11, 8]);

  const subsetFan = buildDynamicEnsembleFan(
    [
      [null, 10, 14],
      [null, 12, 11],
    ],
    3,
  );
  assert.deepEqual(subsetFan.upper, [null, 12, 14]);
  assert.deepEqual(subsetFan.lower, [null, 10, 11]);

  const emptyFan = buildDynamicEnsembleFan([], 3);
  assert.deepEqual(emptyFan.upper, [null, null, null]);
  assert.deepEqual(emptyFan.lower, [null, null, null]);
});

test('computeNightBands groups local nighttime hours (19:00-05:59) cleanly across midnight boundaries', () => {
  // 24 hours starting at 12:00 UTC (station local):
  // indices 0..6 => 12..18 (day)
  // indices 7..17 => 19..23, 00..05 (night -> 11 hours)
  // indices 18..23 => 06..11 (day)
  const start = Date.UTC(2026, 10, 18, 12, 0, 0);
  const slots = Array.from({ length: 24 }, (_, i) => start + i * HOUR_MS);
  const bands = computeNightBands(slots);

  assert.deepEqual(bands, [{ startIndex: 7, endIndex: 17 }]);
  assert.deepEqual(computeNightBands([]), []);

  // Starting during night (02:00) and spanning into a second night (21:00)
  const startNight = Date.UTC(2026, 10, 18, 2, 0, 0);
  const slots2 = Array.from({ length: 20 }, (_, i) => startNight + i * HOUR_MS);
  // 0..3 => 02..05 (night), 4..16 => 06..18 (day), 17..19 => 19..21 (night)
  assert.deepEqual(computeNightBands(slots2), [
    { startIndex: 0, endIndex: 3 },
    { startIndex: 17, endIndex: 19 },
  ]);
});

test('formatStationLocalClock and buildSparklinePath compute accurate local phase and SVG geometry', () => {
  const dayClock = formatStationLocalClock('2026-11-19T14:00:00.000Z', 'CET');
  assert.equal(dayClock.label, '14:00 CET');
  assert.equal(dayClock.isNight, false);

  const nightClock = formatStationLocalClock('2026-11-19T02:00:00.000Z', 'JST');
  assert.equal(nightClock.label, '02:00 JST');
  assert.equal(nightClock.isNight, true);

  const geom = buildSparklinePath([10, 15, 12, 20], 120, 20, 2);
  assert.ok(geom);
  assert.match(geom.linePath, /^M0\.0 /);
  assert.match(geom.areaPath, /Z$/);
  assert.equal(geom.endX, 120);
  assert.equal(geom.endY, 2); // max value maps to top padY

  // Flat line should map cleanly to vertical midpoint without NaN
  const flatGeom = buildSparklinePath([12, 12, 12], 100, 20, 2);
  assert.ok(flatGeom);
  assert.equal(flatGeom.endY, 10);
  assert.equal(buildSparklinePath([12], 100, 20), null);

  const longSeries: TelemetryRecord[] = Array.from({ length: 60 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 10, 18, 0) + i * HOUR_MS).toISOString(),
    temperature_2m: i,
    wind_speed_10m: 5,
    location: 'Berlin',
    period: 'live',
  }));
  const extracted = extractSparklineSeries(longSeries, 48);
  assert.equal(extracted.length, 48);
  assert.equal(extracted[0], 12);
  assert.equal(extracted[47], 59);
});

test('computeStationDeckData gates warming glow to delta > 0 and cooling glow strictly to delta < 0', () => {
  const ts = '2026-11-19T12:00:00.000Z';

  // Case 1: All stations warmer than last year -> only warmest gets isMaxAnomaly, NONE get isMinAnomaly
  const allWarm: TelemetryRecord[] = [
    { time: ts, temperature_2m: 15, wind_speed_10m: 5, location: 'Berlin', period: 'live' },
    { time: ts, temperature_2m: 10, wind_speed_10m: 5, location: 'Berlin', period: 'historical' }, // +5
    { time: ts, temperature_2m: 11, wind_speed_10m: 5, location: 'Sydney', period: 'live' },
    { time: ts, temperature_2m: 10.5, wind_speed_10m: 5, location: 'Sydney', period: 'historical' }, // +0.5
  ];
  const warmDeck = computeStationDeckData(allWarm, { temp: 'C', wind: 'kmh' });
  assert.equal(warmDeck.find((c) => c.id === 'Berlin')?.isMaxAnomaly, true);
  assert.equal(warmDeck.find((c) => c.id === 'Sydney')?.isMinAnomaly, false);
  assert.equal(warmDeck.filter((c) => c.isMinAnomaly).length, 0);

  // Case 2: Mixed warming and cooling -> Berlin warms (+4), Tokyo cools (-3.5)
  const mixed: TelemetryRecord[] = [
    { time: ts, temperature_2m: 14, wind_speed_10m: 5, location: 'Berlin', period: 'live' },
    { time: ts, temperature_2m: 10, wind_speed_10m: 5, location: 'Berlin', period: 'historical' }, // +4
    { time: ts, temperature_2m: 6.5, wind_speed_10m: 5, location: 'Tokyo', period: 'live' },
    { time: ts, temperature_2m: 10, wind_speed_10m: 5, location: 'Tokyo', period: 'historical' }, // -3.5
    { time: ts, temperature_2m: 9, wind_speed_10m: 5, location: 'London', period: 'live' },
    { time: ts, temperature_2m: 10, wind_speed_10m: 5, location: 'London', period: 'historical' }, // -1.0
  ];
  const mixedDeck = computeStationDeckData(mixed, { temp: 'C', wind: 'kmh' });
  assert.equal(mixedDeck.find((c) => c.id === 'Berlin')?.isMaxAnomaly, true);
  assert.equal(mixedDeck.find((c) => c.id === 'Tokyo')?.isMinAnomaly, true);
  assert.equal(mixedDeck.find((c) => c.id === 'London')?.isMinAnomaly, false);
});

test('buildHoldoutBreakdown ranks models, computes margins, and converts units', () => {
  const summaryEntry = {
    utc_offset_seconds: -18000,
    timezone: 'America/New_York',
    timezone_abbreviation: 'GMT-5',
    observed_hours: 96,
    observed_until: '2026-11-18T11:00',
    holdout_hours: 24,
    holdout_mae: {
      linear: { temp_mae: 1.5, wind_mae: 3.6, n: 24 },
      sma: { temp_mae: 3.0, wind_mae: 7.2, n: 24 },
      ema: { temp_mae: 1.0, wind_mae: 3.6, n: 24 },
    },
  };

  const rowsC = buildHoldoutBreakdown(summaryEntry, { temp: 'C', wind: 'kmh' });
  assert.equal(rowsC.length, 3);
  assert.equal(rowsC[0].model, 'ema');
  assert.equal(rowsC[0].isWinner, true);
  assert.equal(rowsC[0].tempMarginDisplay, 'Best');
  assert.equal(rowsC[1].model, 'linear');
  assert.equal(rowsC[1].tempMarginDisplay, '+0.50°C');
  assert.equal(rowsC[2].model, 'sma');
  assert.equal(rowsC[2].tempRatio, 1);

  const rowsF = buildHoldoutBreakdown(summaryEntry, { temp: 'F', wind: 'ms' });
  assert.equal(rowsF[0].tempMaeDisplay, '±1.80°F');
  assert.equal(rowsF[0].windMaeDisplay, '±1.00 m/s');
  assert.equal(rowsF[1].tempMarginDisplay, '+0.90°F');
  assert.deepEqual(buildHoldoutBreakdown(undefined, { temp: 'C', wind: 'kmh' }), []);
});

test('computeEnsembleSpread computes half-spread at horizon and peak divergence', () => {
  const ensemble = {
    linear: { fTemp: [10, 12, 16], fWind: [5, 8, 12] },
    sma: { fTemp: [10, 14, 14], fWind: [5, 10, 10] },
    ema: { fTemp: [10, 10, 12], fWind: [5, 6, 8] },
  };
  const spread = computeEnsembleSpread(ensemble, 0, 12, { temp: 'C', wind: 'kmh' });
  assert.ok(spread);
  // At index 1: max 14, min 10 -> half-spread 2.0
  // At index 2 (horizon end): max 16, min 12 -> half-spread 2.0; wind max 12, min 8 -> half-spread 2.0
  assert.equal(spread.tempAtHorizon, 2.0);
  assert.equal(spread.tempPeak, 2.0);
  assert.equal(spread.windAtHorizon, 2.0);
  assert.equal(spread.tempReadout, '±2.0°C at +12h');
  assert.equal(spread.windReadout, '±2.0 km/h');
});

test('buildStationViewData preserves missing hourly slots as nulls instead of shifting', () => {
  const base = Date.UTC(2026, 10, 18, 12, 0, 0);
  const iso = (hOffset: number) => new Date(base + hOffset * HOUR_MS).toISOString();

  // Missing hour -1 should leave a null gap right before NOW
  const live: TelemetryRecord[] = [
    { time: iso(-2), temperature_2m: 4.0, wind_speed_10m: 8.0, location: 'Berlin', period: 'live' },
    { time: iso(0), temperature_2m: 6.0, wind_speed_10m: 10.0, location: 'Berlin', period: 'live' },
    { time: iso(0), temperature_2m: 3.0, wind_speed_10m: 7.0, location: 'Berlin', period: 'historical' },
  ];
  const pred: PredictionRecord[] = [
    { time: iso(1), predicted_temperature_2m: 7.0, predicted_wind_speed_10m: 11.0, location: 'Berlin', method: 'linear' },
  ];

  const view = buildStationViewData({
    liveRecords: live,
    predRecords: pred,
    stationSummary: {},
    location: 'Berlin',
    model: 'linear',
    horizon: 12,
    units: { temp: 'C', wind: 'kmh' },
  });

  assert.ok(view);
  assert.equal(view.obsHours, 24);
  assert.equal(view.nowIndex, 23);
  assert.equal(view.temps[23], 6.0);
  assert.equal(view.temps[22], null);
  assert.equal(view.temps[21], 4.0);
  assert.equal(view.primarySeries.fTemp[23], 6.0);
  assert.equal(view.primarySeries.fTemp[24], 7.0);
});

test('real uploaded observatory datasets parse, rank holdout winners, and compute YoY anomalies across all 5 stations', () => {
  const root = path.resolve(process.cwd(), '../docs');
  const liveRaw = fs.readFileSync(
    path.join(root, 'sample_telemetry.json'),
    'utf-8',
  );
  const predRaw = fs.readFileSync(
    path.join(root, 'predictions.json'),
    'utf-8',
  );
  const summaryRaw = fs.readFileSync(
    path.join(root, 'station_summary.json'),
    'utf-8',
  );

  const live = parseNdjson<TelemetryRecord>(liveRaw);
  const pred = parseNdjson<PredictionRecord>(predRaw);
  const summaryFile = JSON.parse(summaryRaw) as StationSummaryFile;
  const summary = summaryFile.stations ?? {};

  assert.ok(live.length > 500, 'Expected substantial telemetry records');
  assert.ok(pred.length > 500, 'Expected substantial prediction records');

  // Records are used exactly as the pipeline wrote them; nothing is shifted to "now".
  const clockNow = new Date('2026-11-19T21:28:00Z');
  const deck = computeStationDeckData(live, { temp: 'C', wind: 'kmh' }, summary, clockNow);

  assert.equal(deck.length, 5);
  assert.ok(deck.filter((c) => c.isMaxAnomaly).length <= 1);
  assert.ok(deck.filter((c) => c.isMinAnomaly).length <= 1);

  for (const card of deck) {
    assert.notEqual(card.tempDisplay, '--');
    assert.equal(card.sparklineValues.length, 48, `Expected 48h sparkline for ${card.id}`);
    const st = summary[card.id];
    // Card clock = the station's current local time (live), not the data time.
    assert.deepEqual(
      { label: card.localTimeLabel, isNight: card.isNight },
      stationClockNow(st, clockNow),
    );
    assert.match(card.coordsLabel, /°[NS] · .*°[EW]/);
    const yoy = computeStationYoyDelta(live, card.id, 'C');
    assert.ok(yoy !== null, `Expected YoY delta for ${card.id}`);
  }

  // Verify valid holdout winners are computed for all stations
  for (const stationName of ['Berlin', 'Tokyo', 'New York', 'London', 'Sydney']) {
    const best = findBestHoldoutModel(summary[stationName]);
    assert.ok(best === 'linear' || best === 'sma' || best === 'ema', `Expected valid best model for ${stationName}`);
  }

  // Verify view data in Fahrenheit and m/s for New York
  const nyView = buildStationViewData({
    liveRecords: live,
    predRecords: pred,
    stationSummary: summary,
    location: 'New York',
    model: 'ensemble',
    horizon: 24,
    units: { temp: 'F', wind: 'ms' },
  });
  assert.ok(nyView);
  assert.equal(nyView.obsHours, 48);
  assert.equal(nyView.labels.length, 72);
  const expectedNyBest = findBestHoldoutModel(summary['New York']) ?? 'ensemble';
  assert.equal(nyView.winnerModel, expectedNyBest);
  assert.ok(nyView.winnerBannerText.length > 0);
  assert.equal(nyView.recentObservations.length, 15);
  assert.ok(nyView.ensembleSeries !== null);
  assert.equal(nyView.maeSourceModel, expectedNyBest);
  assert.equal(nyView.holdoutBreakdown.length, 3);
  assert.equal(nyView.holdoutBreakdown[0].model, expectedNyBest);
  assert.equal(nyView.holdoutBreakdown[0].n, summary['New York'].holdout_mae[expectedNyBest as 'linear' | 'sma' | 'ema']?.n);
  assert.equal(nyView.provenance.timezone, 'America/New_York');
  assert.equal(nyView.provenance.observedHours, summary['New York'].observed_hours);
  // NY observed_until converted to Central European Time
  assert.equal(nyView.provenance.observedUntilLabel, `${fmtDisplay(wallToUtcMs(wallMs(summary['New York'].observed_until), summary['New York']))} CET`);
  assert.equal(nyView.tzLabel, 'CET');
  assert.equal(nyView.provenance.holdoutPoints, summary['New York'].holdout_mae[expectedNyBest as 'linear' | 'sma' | 'ema']?.n);
  assert.ok(nyView.ensembleSpread !== null);
  assert.match(nyView.ensembleSpread.tempReadout, /^±\d+\.\d°F at \+24h$/);
  assert.equal(nyView.slotTimestampsMs.length, 72);
  assert.ok(nyView.nightBands.length >= 2, 'Expected multiple diurnal night bands across 72h window');
});

test('meteorological chart reference line helpers compute freezing point, YoY mean, and Beaufort 4 wind thresholds across units', () => {
  assert.equal(computeSeriesMean([null, null]), null);
  assert.equal(computeSeriesMean([4, null, 6, 8]), 6);

  const tempLinesC = buildTempReferenceLines([2, 4, null, 6], 'C', true);
  assert.equal(tempLinesC.length, 2);
  assert.deepEqual(tempLinesC[0], {
    id: 'freeze',
    value: 0,
    label: '0°C Freeze',
    tone: 'freeze',
    align: 'left',
  });
  assert.equal(tempLinesC[1].id, 'yoy-mean');
  assert.equal(tempLinesC[1].value, 4);
  assert.equal(tempLinesC[1].label, 'YoY Mean 4.0°C');

  const tempLinesFNoYoy = buildTempReferenceLines([35, 45], 'F', false);
  assert.equal(tempLinesFNoYoy.length, 1);
  assert.equal(tempLinesFNoYoy[0].value, 32);
  assert.equal(tempLinesFNoYoy[0].label, '32°F Freeze');

  const windKmh = buildWindReferenceLines('kmh');
  assert.equal(windKmh.length, 1);
  assert.equal(windKmh[0].value, 20);
  assert.equal(windKmh[0].label, '20 km/h · Bft 4');

  const windMs = buildWindReferenceLines('ms');
  assert.equal(windMs.length, 1);
  assert.ok(Math.abs(windMs[0].value - 5.56) < 0.01);
  assert.equal(windMs[0].label, '5.6 m/s · Bft 4');
});

test('classifySpreadSeverity and computeEnsembleSpread stay unit-invariant across °C and °F thresholds', () => {
  assert.equal(classifySpreadSeverity(0.4).severity, 'low');
  assert.equal(classifySpreadSeverity(0.99).severity, 'low');
  assert.equal(classifySpreadSeverity(1.0).severity, 'moderate');
  assert.equal(classifySpreadSeverity(2.5).severity, 'moderate');
  assert.equal(classifySpreadSeverity(2.51).severity, 'high');

  // 0.8°C half-spread = 1.44°F half-spread -> must remain 'low' (emerald) even in °F
  const tightF = computeEnsembleSpread(
    {
      linear: { fTemp: [50, 51.44], fWind: [10, 11] },
      sma: { fTemp: [50, 50.0], fWind: [10, 10] },
      ema: { fTemp: [50, 48.56], fWind: [10, 9] },
    },
    0,
    12,
    { temp: 'F', wind: 'kmh' },
  );
  assert.ok(tightF);
  assert.ok(Math.abs(tightF.tempAtHorizonC - 0.8) < 1e-6);
  assert.equal(tightF.severity, 'low');

  // 3.0°C half-spread -> 'high' (rose)
  const wideC = computeEnsembleSpread(
    {
      linear: { fTemp: [10, 16], fWind: [5, 8] },
      sma: { fTemp: [10, 13], fWind: [5, 7] },
      ema: { fTemp: [10, 10], fWind: [5, 6] },
    },
    0,
    48,
    { temp: 'C', wind: 'kmh' },
  );
  assert.ok(wideC);
  assert.equal(wideC.severity, 'high');
});

test('classifyObservationReading assigns normal, elevated, severe, and freeze tones with explanatory reasons', () => {
  const normal = classifyObservationReading({
    tempC: 12.0,
    windKmh: 9.5,
    histTempC: 10.5,
    units: { temp: 'C', wind: 'kmh' },
  });
  assert.equal(normal.status, 'normal');
  assert.match(normal.reason, /Nominal conditions/);

  const elevatedWind = classifyObservationReading({
    tempC: 12.0,
    windKmh: 22.5,
    histTempC: 11.0,
    units: { temp: 'C', wind: 'kmh' },
  });
  assert.equal(elevatedWind.status, 'elevated');
  assert.match(elevatedWind.reason, /Brisk wind.*22\.5 km\/h/);

  const elevatedAnomaly = classifyObservationReading({
    tempC: 16.0,
    windKmh: 8.0,
    histTempC: 11.0,
    units: { temp: 'C', wind: 'kmh' },
  });
  assert.equal(elevatedAnomaly.status, 'elevated');
  assert.match(elevatedAnomaly.reason, /Moderate warm anomaly/);

  const severeWind = classifyObservationReading({
    tempC: 14.0,
    windKmh: 31.0,
    histTempC: 12.0,
    units: { temp: 'C', wind: 'kmh' },
  });
  assert.equal(severeWind.status, 'severe');
  assert.match(severeWind.reason, /Strong wind/);

  const severeAnomaly = classifyObservationReading({
    tempC: 19.0,
    windKmh: 10.0,
    histTempC: 10.0,
    units: { temp: 'C', wind: 'kmh' },
  });
  assert.equal(severeAnomaly.status, 'severe');
  assert.match(severeAnomaly.reason, /Severe warm anomaly/);

  const freezing = classifyObservationReading({
    tempC: -1.5,
    windKmh: 12.0,
    histTempC: 2.0,
    units: { temp: 'F', wind: 'ms' },
  });
  assert.equal(freezing.status, 'freeze');
  assert.match(freezing.reason, /Freezing air.*29\.3°F/);
});

