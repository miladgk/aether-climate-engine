import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvFilename,
  buildStationTelemetryCsv,
  DEFAULT_OBSERVATORY_STATE,
  nextForecastModel,
  nextHorizon,
  nextTheme,
  parseObservatoryQuery,
  serializeObservatoryQuery,
} from './observatoryState';
import { StationViewData } from '../types/telemetry';

test('parseObservatoryQuery and serializeObservatoryQuery round-trip valid parameters and sanitize invalid ones', () => {
  const parsed = parseObservatoryQuery(
    '?station=new+york&model=EMA&horizon=24&temp=f&wind=ms&theme=Nord',
  );
  assert.deepEqual(parsed, {
    station: 'New York',
    model: 'ema',
    horizon: 24,
    units: { temp: 'F', wind: 'ms' },
    theme: 'nord',
  });

  const query = serializeObservatoryQuery(parsed);
  assert.equal(
    query,
    '?station=New+York&model=ema&horizon=24&temp=F&wind=ms&theme=nord',
  );
  assert.deepEqual(parseObservatoryQuery(query), parsed);

  // Ember aliases cleanly to default theme
  assert.equal(parseObservatoryQuery('?theme=ember').theme, 'default');
  assert.match(serializeObservatoryQuery(DEFAULT_OBSERVATORY_STATE), /theme=ember/);

  // Invalid values safely fall back to defaults
  const sanitized = parseObservatoryQuery(
    '?station=Atlantis&model=magic&horizon=99&temp=K&wind=knots&theme=neon',
  );
  assert.deepEqual(sanitized, DEFAULT_OBSERVATORY_STATE);
});

test('keyboard cycle helpers wrap cleanly around models, horizons, and themes', () => {
  assert.equal(nextForecastModel('linear'), 'sma');
  assert.equal(nextForecastModel('sma'), 'ema');
  assert.equal(nextForecastModel('ema'), 'ensemble');
  assert.equal(nextForecastModel('ensemble'), 'linear');

  assert.equal(nextHorizon(12), 24);
  assert.equal(nextHorizon(24), 48);
  assert.equal(nextHorizon(48), 12);

  assert.equal(nextTheme('default'), 'nord');
  assert.equal(nextTheme('nord'), 'stone');
  assert.equal(nextTheme('stone'), 'default');
});

test('buildStationTelemetryCsv generates well-formed CSV for both ensemble and single-model views', () => {
  const mockView: StationViewData = {
    labels: ['Nov 19 10:00 AM', 'Nov 19 11:00 AM', 'Nov 19 12:00 PM'],
    slotTimestampsMs: [0, 3600000, 7200000],
    nightBands: [],
    temps: [10.5, 11.2, null],
    winds: [5.0, 6.2, null],
    histTemps: [8.0, 8.5, 9.0],
    histWinds: [4.0, 4.5, 5.0],
    primarySeries: {
      fTemp: [null, 11.2, 12.4],
      fWind: [null, 6.2, 7.1],
    },
    ensembleSeries: {
      linear: { fTemp: [null, 11.2, 12.4], fWind: [null, 6.2, 7.1] },
      sma: { fTemp: [null, 11.2, 11.8], fWind: [null, 6.2, 6.5] },
      ema: { fTemp: [null, 11.2, 12.1], fWind: [null, 6.2, 6.9] },
    },
    obsHours: 2,
    horizon: 12,
    nowIndex: 1,
    tzLabel: 'GMT-5',
    latestTemp: 11.2,
    latestWind: 6.2,
    latestWindKmh: 6.2,
    beaufort: 'Light Breeze',
    tempDeltaDisplay: '+2.7°C vs YoY −1yr',
    tempDeltaTone: 'pos',
    windDeltaDisplay: '+1.7 km/h vs YoY −1yr',
    windDeltaTone: 'pos',
    forecastPeakDisplay: '11.2° → 12.4°C',
    tempMaeDisplay: '±1.25 °C',
    windMaeDisplay: '±4.05 km/h',
    maeSourceModel: 'ema',
    holdoutHours: 24,
    holdoutBreakdown: [],
    ensembleSpread: null,
    winnerModel: 'ema',
    winnerBannerText: '★ Best in New York: EMA (±1.25°C)',
    winnerBannerTitle: 'test',
    recentObservations: [],
    provenance: {
      timezone: 'America/New_York',
      timezoneAbbreviation: 'GMT-5',
      observedUntilLabel: 'Nov 19 11:00 AM GMT-5',
      observedHours: 96,
      coordsLabel: '40.71°N · 74.00°W',
      coordsSource: 'config',
      holdoutPoints: 24,
    },
  };

  assert.equal(buildCsvFilename('New York', 'ensemble', 48), 'aether-new-york-ensemble-48h.csv');

  const ensembleCsv = buildStationTelemetryCsv({
    station: 'New York',
    model: 'ensemble',
    viewData: mockView,
    units: { temp: 'C', wind: 'kmh' },
  });
  const lines = ensembleCsv.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(
    lines[0],
    'station,local_time,timezone,phase,observed_temp_C,linear_temp_C,sma_temp_C,ema_temp_C,yoy_temp_C,observed_wind_kmh,linear_wind_kmh,sma_wind_kmh,ema_wind_kmh,yoy_wind_kmh',
  );
  assert.equal(lines[1], 'New York,Nov 19 10:00 AM,GMT-5,observed,10.50,,,,8.00,5.00,,,,4.00');
  assert.equal(lines[2], 'New York,Nov 19 11:00 AM,GMT-5,now,11.20,11.20,11.20,11.20,8.50,6.20,6.20,6.20,6.20,4.50');
  assert.equal(lines[3], 'New York,Nov 19 12:00 PM,GMT-5,forecast,,12.40,11.80,12.10,9.00,,7.10,6.50,6.90,5.00');

  const singleCsv = buildStationTelemetryCsv({
    station: 'Berlin',
    model: 'linear',
    viewData: { ...mockView, ensembleSeries: null },
    units: { temp: 'F', wind: 'ms' },
  });
  const singleLines = singleCsv.split('\n');
  assert.equal(
    singleLines[0],
    'station,local_time,timezone,phase,observed_temp_F,forecast_linear_temp_F,yoy_temp_F,observed_wind_ms,forecast_linear_wind_ms,yoy_wind_ms',
  );
});

test('buildStationTelemetryCsv stamps every row with the pipeline snapshot time when known', () => {
  const view = {
    labels: ['Nov 19 10:00 AM'],
    temps: [10.5],
    winds: [5],
    histTemps: [8],
    histWinds: [4],
    primarySeries: { fTemp: [null], fWind: [null] },
    ensembleSeries: null,
    nowIndex: 0,
    tzLabel: 'GMT+1',
  } as unknown as StationViewData;

  const csv = buildStationTelemetryCsv({
    station: 'Berlin',
    model: 'linear',
    viewData: view,
    units: { temp: 'C', wind: 'kmh' },
    generatedAtUtc: '2026-11-18T16:02:17Z',
  }).split('\n');

  assert.match(csv[0], /,snapshot_generated_utc$/);
  assert.equal(csv[1], 'Berlin,Nov 19 10:00 AM,GMT+1,now,10.50,,8.00,5.00,,4.00,2026-11-18T16:02:17Z');
});
