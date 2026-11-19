import { useCallback, useEffect, useRef, useState } from 'react';
import Chart, { ActiveElement, ChartDataset, ChartEvent, Plugin } from 'chart.js/auto';
import {
  ChartReferenceLine,
  ForecastModel,
  NightBand,
  StationViewData,
  ThemeMode,
  UnitPreferences,
} from '../types/telemetry';
import {
  buildDynamicEnsembleFan,
  buildTempReferenceLines,
  buildWindReferenceLines,
} from '../utils/telemetry';

type SeriesKey = 'observed' | 'forecast' | 'linear' | 'sma' | 'ema' | 'fan' | 'yoy';

interface NowMeridianOptions {
  index?: number;
  color?: string;
  lineColor?: string;
  pillBg?: string;
  pillText?: string;
  showBeacon?: boolean;
}

interface DayNightBandsOptions {
  bands?: NightBand[];
  fillColor?: string;
  moonColor?: string;
  nowIndex?: number;
}

interface SyncCrosshairOptions {
  getHoverIndex?: () => number | null;
  lineColor?: string;
  dotFill?: string;
}

interface ReferenceLinesOptions {
  lines?: ChartReferenceLine[];
  colors?: {
    freezeLine: string;
    freezeText: string;
    yoyLine: string;
    yoyText: string;
    windLine: string;
    windText: string;
    pillBg: string;
  };
}

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType> {
    nowMeridian?: NowMeridianOptions;
    dayNightBands?: DayNightBandsOptions;
    syncCrosshair?: SyncCrosshairOptions;
    referenceLines?: ReferenceLinesOptions;
  }
}

const dayNightBandsPlugin: Plugin = {
  id: 'dayNightBands',
  beforeDatasetsDraw: (chart) => {
    const cfg = chart.options.plugins?.dayNightBands;
    if (!cfg?.bands?.length) return;

    const xScale = chart.scales.x;
    if (!xScale) return;

    const { ctx, chartArea } = chart;
    const total = chart.data.labels?.length ?? 0;
    if (total < 2) return;

    const step = Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0));
    const halfStep = step / 2;
    const nowX =
      cfg.nowIndex !== undefined && cfg.nowIndex >= 0
        ? xScale.getPixelForValue(cfg.nowIndex)
        : null;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top,
    );
    ctx.clip();

    for (const band of cfg.bands) {
      if (band.startIndex === undefined || band.endIndex === undefined) continue;
      const rawLeft = xScale.getPixelForValue(band.startIndex) - halfStep;
      const rawRight = xScale.getPixelForValue(band.endIndex) + halfStep;
      const left = Math.max(chartArea.left, rawLeft);
      const right = Math.min(chartArea.right, rawRight);
      const width = right - left;
      if (width <= 1) continue;

      ctx.fillStyle = cfg.fillColor || 'rgba(129, 140, 248, 0.055)';
      ctx.fillRect(left, chartArea.top, width, chartArea.bottom - chartArea.top);

      // Subtle moon glyph when band has ample room and stays clear of NOW pill
      const centerX = left + width / 2;
      const clearOfNow = nowX === null || Math.abs(centerX - nowX) > 28;
      if (width >= 28 && clearOfNow) {
        ctx.font = "400 9px 'DM Mono', monospace";
        ctx.fillStyle = cfg.moonColor || 'rgba(165, 180, 252, 0.28)';
        ctx.textAlign = 'center';
        ctx.fillText('☾', centerX, chartArea.top + 11);
      }
    }

    ctx.restore();
  },
};

const nowMeridianPlugin: Plugin = {
  id: 'nowMeridian',
  afterDraw: (chart) => {
    const cfg = chart.options.plugins?.nowMeridian;
    if (!cfg || cfg.index === undefined || cfg.index < 0) return;

    const xScale = chart.scales.x;
    const meta = chart.getDatasetMeta(0);
    const pt = meta?.data?.[cfg.index];
    const nowX = pt ? pt.x : xScale?.getPixelForValue(cfg.index);
    if (nowX === undefined || !Number.isFinite(nowX)) return;

    const { ctx, chartArea } = chart;
    ctx.save();

    // Vertical NOW Meridian Line
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(nowX, chartArea.top);
    ctx.lineTo(nowX, chartArea.bottom);
    ctx.strokeStyle = cfg.lineColor || 'rgba(245, 158, 11, 0.38)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // "NOW" Pill Label at Top of Meridian
    ctx.fillStyle = cfg.pillBg || 'rgba(245, 158, 11, 0.18)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(nowX - 18, chartArea.top, 36, 15, 4);
    } else {
      ctx.rect(nowX - 18, chartArea.top, 36, 15);
    }
    ctx.fill();
    ctx.font = "500 9px 'DM Mono', monospace";
    ctx.fillStyle = cfg.pillText || '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText('NOW', nowX, chartArea.top + 11);

    // Pulsing Beacon on Current Observation (only when Observed series is visible)
    if (cfg.showBeacon !== false && pt && chart.isDatasetVisible(0) && Number.isFinite(pt.y)) {
      const pulse = Math.abs(Math.sin(Date.now() / 850));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4 + pulse * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = cfg.color || '#f59e0b';
      ctx.shadowColor = cfg.color || '#f59e0b';
      ctx.shadowBlur = 8 + pulse * 6;
      ctx.fill();
    }

    ctx.restore();
  },
};

const syncCrosshairPlugin: Plugin = {
  id: 'syncCrosshair',
  afterDraw: (chart) => {
    const cfg = chart.options.plugins?.syncCrosshair;
    const idx = cfg?.getHoverIndex?.();
    if (idx === null || idx === undefined || idx < 0) return;

    const xScale = chart.scales.x;
    if (!xScale) return;
    const x = xScale.getPixelForValue(idx);
    const { ctx, chartArea } = chart;
    if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;

    ctx.save();

    // Full-height synchronized vertical crosshair hairline
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.strokeStyle = cfg?.lineColor || 'rgba(243, 237, 226, 0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Highlight rings at the intersected data points on visible non-fan series
    chart.data.datasets.forEach((ds, dsIdx) => {
      if (ds.label === 'Ensemble Fan Max' || ds.label === 'Ensemble Fan Min') return;
      if (!chart.isDatasetVisible(dsIdx)) return;
      const meta = chart.getDatasetMeta(dsIdx);
      const val = ds.data[idx];
      if (val === null || val === undefined) return;
      const el = meta.data?.[idx];
      if (!el || !Number.isFinite(el.y)) return;

      const strokeColor =
        typeof ds.borderColor === 'string' && ds.borderColor !== 'transparent'
          ? ds.borderColor
          : '#f59e0b';

      ctx.beginPath();
      ctx.arc(el.x, el.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = cfg?.dotFill || '#0c0b0a';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    });

    ctx.restore();
  },
};

const referenceLinesPlugin: Plugin = {
  id: 'referenceLines',
  beforeDatasetsDraw: (chart) => {
    const cfg = chart.options.plugins?.referenceLines;
    if (!cfg?.lines?.length || !cfg.colors) return;

    const yScale = chart.scales.y;
    if (!yScale) return;

    const { ctx, chartArea } = chart;
    const min = yScale.min;
    const max = yScale.max;

    ctx.save();

    for (const line of cfg.lines) {
      if (
        line.value === undefined ||
        !Number.isFinite(line.value) ||
        line.value < min ||
        line.value > max
      ) {
        continue;
      }

      const y = yScale.getPixelForValue(line.value);
      if (!Number.isFinite(y) || y < chartArea.top - 1 || y > chartArea.bottom + 1) {
        continue;
      }

      const lineColor =
        line.tone === 'freeze'
          ? cfg.colors.freezeLine
          : line.tone === 'yoy'
            ? cfg.colors.yoyLine
            : cfg.colors.windLine;

      // Subtle dashed horizontal threshold line rendered behind curves and bars
      ctx.beginPath();
      ctx.setLineDash([4, 5]);
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.strokeStyle = lineColor || 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  },
  afterDatasetsDraw: (chart) => {
    const cfg = chart.options.plugins?.referenceLines;
    if (!cfg?.lines?.length || !cfg.colors) return;

    const yScale = chart.scales.y;
    if (!yScale) return;

    const { ctx, chartArea } = chart;
    const min = yScale.min;
    const max = yScale.max;

    ctx.save();
    ctx.font = "500 8.5px 'DM Mono', monospace";

    for (const line of cfg.lines) {
      if (
        line.value === undefined ||
        !Number.isFinite(line.value) ||
        line.value < min ||
        line.value > max
      ) {
        continue;
      }

      const y = yScale.getPixelForValue(line.value);
      if (!Number.isFinite(y) || y < chartArea.top - 1 || y > chartArea.bottom + 1) {
        continue;
      }

      const label = line.label ?? '';
      if (!label) continue;

      const lineColor =
        line.tone === 'freeze'
          ? cfg.colors.freezeLine
          : line.tone === 'yoy'
            ? cfg.colors.yoyLine
            : cfg.colors.windLine;
      const textColor =
        line.tone === 'freeze'
          ? cfg.colors.freezeText
          : line.tone === 'yoy'
            ? cfg.colors.yoyText
            : cfg.colors.windText;

      // Compact inline pill label drawn above curves/bars (and below tooltips/crosshair)
      const textW = ctx.measureText(label).width;
      const padX = 5;
      const pillW = textW + padX * 2;
      const pillH = 13;
      const pillX =
        line.align === 'left'
          ? chartArea.left + 6
          : chartArea.right - pillW - 6;

      // Keep pill inside chartArea vertically (place below line only if very close to top)
      const nearTop = y - pillH - 3 < chartArea.top + 14;
      const pillY = nearTop ? Math.min(chartArea.bottom - pillH - 2, y + 3) : y - pillH - 3;

      ctx.fillStyle = cfg.colors.pillBg || 'rgba(16, 14, 12, 0.9)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(pillX, pillY, pillW, pillH, 3.5);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();

      ctx.strokeStyle = lineColor || 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 0.65;
      ctx.stroke();

      ctx.fillStyle = textColor || '#94a3b8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pillX + padX, pillY + pillH / 2 + 0.5);
    }

    ctx.restore();
  },
};

Chart.register(
  dayNightBandsPlugin,
  referenceLinesPlugin,
  nowMeridianPlugin,
  syncCrosshairPlugin,
);

interface ThemeChartPalette {
  textColor: string;
  gridColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipTitle: string;
  tooltipBody: string;
  tempLine: string;
  tempGradTop: string;
  tempGradBottom: string;
  windBarBg: string;
  windBarBorder: string;
  windBeacon: string;
  forecastGreen: string;
  smaTempLine: string;
  smaWindLine: string;
  emaLine: string;
  fanFill: string;
  fanSwatchBorder: string;
  yoyRose: string;
  meridianLine: string;
  meridianPillBg: string;
  meridianPillText: string;
  nightFill: string;
  nightMoon: string;
  crosshairLine: string;
  crosshairDotFill: string;
  refFreezeLine: string;
  refFreezeText: string;
  refYoyLine: string;
  refYoyText: string;
  refWindLine: string;
  refWindText: string;
  refPillBg: string;
}

function getThemePalette(theme: ThemeMode): ThemeChartPalette {
  if (theme === 'stone') {
    return {
      textColor: '#57534e',
      gridColor: 'rgba(28, 25, 23, 0.08)',
      tooltipBg: 'rgba(255, 255, 255, 0.96)',
      tooltipBorder: 'rgba(180, 83, 9, 0.35)',
      tooltipTitle: '#1c1917',
      tooltipBody: '#44403c',
      tempLine: '#b45309',
      tempGradTop: 'rgba(180, 83, 9, 0.22)',
      tempGradBottom: 'rgba(180, 83, 9, 0.0)',
      windBarBg: 'rgba(2, 132, 199, 0.38)',
      windBarBorder: 'rgba(2, 132, 199, 0.78)',
      windBeacon: '#0284c7',
      forecastGreen: '#059669',
      smaTempLine: '#0284c7',
      smaWindLine: '#d97706',
      emaLine: '#9333ea',
      fanFill: 'rgba(5, 150, 105, 0.14)',
      fanSwatchBorder: 'rgba(5, 150, 105, 0.5)',
      yoyRose: '#e11d48',
      meridianLine: 'rgba(180, 83, 9, 0.42)',
      meridianPillBg: 'rgba(180, 83, 9, 0.14)',
      meridianPillText: '#92400e',
      nightFill: 'rgba(28, 25, 23, 0.045)',
      nightMoon: 'rgba(87, 83, 78, 0.42)',
      crosshairLine: 'rgba(28, 25, 23, 0.32)',
      crosshairDotFill: '#ffffff',
      refFreezeLine: 'rgba(2, 132, 199, 0.42)',
      refFreezeText: '#0369a1',
      refYoyLine: 'rgba(225, 29, 72, 0.32)',
      refYoyText: '#be123c',
      refWindLine: 'rgba(180, 83, 9, 0.38)',
      refWindText: '#b45309',
      refPillBg: 'rgba(255, 255, 255, 0.92)',
    };
  }
  if (theme === 'nord') {
    return {
      textColor: '#8190a5',
      gridColor: 'rgba(216, 222, 233, 0.07)',
      tooltipBg: 'rgba(17, 25, 42, 0.95)',
      tooltipBorder: 'rgba(136, 192, 208, 0.42)',
      tooltipTitle: '#eceff4',
      tooltipBody: '#d8dee9',
      tempLine: '#88c0d0',
      tempGradTop: 'rgba(136, 192, 208, 0.24)',
      tempGradBottom: 'rgba(136, 192, 208, 0.0)',
      windBarBg: 'rgba(129, 161, 193, 0.42)',
      windBarBorder: 'rgba(129, 161, 193, 0.8)',
      windBeacon: '#81a1c1',
      forecastGreen: '#a3be8c',
      smaTempLine: '#81a1c1',
      smaWindLine: '#ebcb8b',
      emaLine: '#b48ead',
      fanFill: 'rgba(163, 190, 140, 0.14)',
      fanSwatchBorder: 'rgba(163, 190, 140, 0.52)',
      yoyRose: '#bf616a',
      meridianLine: 'rgba(136, 192, 208, 0.42)',
      meridianPillBg: 'rgba(136, 192, 208, 0.18)',
      meridianPillText: '#88c0d0',
      nightFill: 'rgba(136, 192, 208, 0.05)',
      nightMoon: 'rgba(136, 192, 208, 0.32)',
      crosshairLine: 'rgba(236, 239, 244, 0.32)',
      crosshairDotFill: '#0b111e',
      refFreezeLine: 'rgba(136, 192, 208, 0.44)',
      refFreezeText: '#88c0d0',
      refYoyLine: 'rgba(191, 97, 106, 0.36)',
      refYoyText: '#d08770',
      refWindLine: 'rgba(235, 203, 139, 0.38)',
      refWindText: '#ebcb8b',
      refPillBg: 'rgba(17, 25, 42, 0.9)',
    };
  }
  return {
    textColor: '#8c8275',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    tooltipBg: 'rgba(18, 16, 14, 0.94)',
    tooltipBorder: 'rgba(245, 158, 11, 0.35)',
    tooltipTitle: '#f3ede2',
    tooltipBody: '#cbd5e1',
    tempLine: '#f59e0b',
    tempGradTop: 'rgba(245, 158, 11, 0.24)',
    tempGradBottom: 'rgba(245, 158, 11, 0.0)',
    windBarBg: 'rgba(56, 189, 248, 0.42)',
    windBarBorder: 'rgba(56, 189, 248, 0.75)',
    windBeacon: '#38bdf8',
    forecastGreen: '#10b981',
    smaTempLine: '#38bdf8',
    smaWindLine: '#fbbf24',
    emaLine: '#c084fc',
    fanFill: 'rgba(16, 185, 129, 0.12)',
    fanSwatchBorder: 'rgba(16, 185, 129, 0.48)',
    yoyRose: '#f43f5e',
    meridianLine: 'rgba(245, 158, 11, 0.38)',
    meridianPillBg: 'rgba(245, 158, 11, 0.18)',
    meridianPillText: '#fbbf24',
    nightFill: 'rgba(129, 140, 248, 0.055)',
    nightMoon: 'rgba(165, 180, 252, 0.28)',
    crosshairLine: 'rgba(243, 237, 226, 0.34)',
    crosshairDotFill: '#0c0b0a',
    refFreezeLine: 'rgba(56, 189, 248, 0.42)',
    refFreezeText: '#7dd3fc',
    refYoyLine: 'rgba(244, 63, 94, 0.34)',
    refYoyText: '#fda4af',
    refWindLine: 'rgba(245, 158, 11, 0.38)',
    refWindText: '#fbbf24',
    refPillBg: 'rgba(16, 14, 12, 0.9)',
  };
}

function buildActiveElementsForIndex(
  chart: Chart<'line' | 'bar', (number | null)[], string>,
  index: number,
): { datasetIndex: number; index: number }[] {
  const result: { datasetIndex: number; index: number }[] = [];
  chart.data.datasets.forEach((ds, datasetIndex) => {
    if (ds.label === 'Ensemble Fan Max' || ds.label === 'Ensemble Fan Min') return;
    if (!chart.isDatasetVisible(datasetIndex)) return;
    const val = ds.data[index];
    if (val !== null && val !== undefined) {
      result.push({ datasetIndex, index });
    }
  });
  return result;
}

interface HorizonChartsProps {
  viewData: StationViewData | null;
  model: ForecastModel;
  units: UnitPreferences;
  theme: ThemeMode;
}

export function HorizonCharts({ viewData, model, units, theme }: HorizonChartsProps) {
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempChartRef = useRef<Chart<'line', (number | null)[], string> | null>(null);
  const windChartRef = useRef<Chart<'bar' | 'line', (number | null)[], string> | null>(null);

  const hoverIndexRef = useRef<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const [hiddenSeries, setHiddenSeries] = useState<Record<SeriesKey, boolean>>({
    observed: false,
    forecast: false,
    linear: false,
    sma: false,
    ema: false,
    fan: false,
    yoy: false,
  });

  const toggleSeries = useCallback((key: SeriesKey) => {
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const syncHoverAcrossCharts = useCallback(
    (source: 'temp' | 'wind', nextIdx: number | null) => {
      if (hoverIndexRef.current === nextIdx) return;
      hoverIndexRef.current = nextIdx;
      setHoverIndex(nextIdx);

      const partner = source === 'temp' ? windChartRef.current : tempChartRef.current;
      const active = source === 'temp' ? tempChartRef.current : windChartRef.current;

      if (partner) {
        if (nextIdx !== null) {
          const activeEls = buildActiveElementsForIndex(
            partner as Chart<'line' | 'bar', (number | null)[], string>,
            nextIdx,
          );
          const xPos = partner.scales.x?.getPixelForValue(nextIdx) ?? partner.chartArea.left;
          const yPos = (partner.chartArea.top + partner.chartArea.bottom) / 2;
          partner.setActiveElements(activeEls);
          partner.tooltip?.setActiveElements(activeEls, { x: xPos, y: yPos });
        } else {
          partner.setActiveElements([]);
          partner.tooltip?.setActiveElements([], { x: 0, y: 0 });
        }
        partner.draw();
      }

      if (active) {
        if (nextIdx === null) {
          active.setActiveElements([]);
          active.tooltip?.setActiveElements([], { x: 0, y: 0 });
        }
        active.draw();
      }
    },
    [],
  );

  // Clear synchronized hover whenever active data window changes
  useEffect(() => {
    hoverIndexRef.current = null;
    setHoverIndex(null);
  }, [viewData]);

  useEffect(() => {
    if (!viewData || !tempCanvasRef.current || !windCanvasRef.current) return;

    const palette = getThemePalette(theme);
    const {
      labels,
      nightBands,
      temps,
      winds,
      histTemps,
      histWinds,
      primarySeries,
      ensembleSeries,
      nowIndex,
    } = viewData;

    const tempUnitSuffix = units.temp === 'C' ? '°C' : '°F';
    const windUnitSuffix = units.wind === 'kmh' ? ' km/h' : ' m/s';

    const tempRefLines = buildTempReferenceLines(histTemps, units.temp, !hiddenSeries.yoy);
    const windRefLines = buildWindReferenceLines(units.wind);
    const refColors = {
      freezeLine: palette.refFreezeLine,
      freezeText: palette.refFreezeText,
      yoyLine: palette.refYoyLine,
      yoyText: palette.refYoyText,
      windLine: palette.refWindLine,
      windText: palette.refWindText,
      pillBg: palette.refPillBg,
    };

    const makeBaseOptions = (source: 'temp' | 'wind', beaconColor: string) => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      animation: false as const,
      onHover: (_event: ChartEvent, elements: ActiveElement[]) => {
        const idx = elements.length > 0 ? elements[0].index : null;
        syncHoverAcrossCharts(source, idx);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.tooltipBg,
          borderColor: palette.tooltipBorder,
          borderWidth: 1,
          titleColor: palette.tooltipTitle,
          bodyColor: palette.tooltipBody,
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: "'DM Mono', monospace", size: 10 },
          bodyFont: { family: "'DM Mono', monospace", size: 10 },
          filter: (item: {
            dataset: { label?: string };
            datasetIndex: number;
            raw: unknown;
            chart: { isDatasetVisible: (index: number) => boolean };
          }) =>
            item.dataset.label !== 'Ensemble Fan Max' &&
            item.dataset.label !== 'Ensemble Fan Min' &&
            item.raw !== null &&
            item.raw !== undefined &&
            item.chart.isDatasetVisible(item.datasetIndex),
          callbacks: {
            label: (ctx: { dataset: { label?: string }; raw: unknown }) => {
              const num = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const suffix = source === 'temp' ? tempUnitSuffix : windUnitSuffix;
              if (!Number.isFinite(num)) return '';
              return ` ${ctx.dataset.label ?? ''}: ${num.toFixed(1)}${suffix}`;
            },
          },
        },
        dayNightBands: {
          bands: nightBands,
          fillColor: palette.nightFill,
          moonColor: palette.nightMoon,
          nowIndex,
        },
        referenceLines: {
          lines: source === 'temp' ? tempRefLines : windRefLines,
          colors: refColors,
        },
        nowMeridian: {
          index: nowIndex,
          color: beaconColor,
          lineColor: palette.meridianLine,
          pillBg: palette.meridianPillBg,
          pillText: palette.meridianPillText,
          showBeacon: !hiddenSeries.observed,
        },
        syncCrosshair: {
          getHoverIndex: () => hoverIndexRef.current,
          lineColor: palette.crosshairLine,
          dotFill: palette.crosshairDotFill,
        },
      },
      scales: {
        y: {
          grid: { color: palette.gridColor },
          border: { display: false },
          ticks: {
            maxTicksLimit: 5,
            color: palette.textColor,
            font: { family: "'DM Mono', monospace", size: 10 },
          },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: true,
            autoSkipPadding: 22,
            maxTicksLimit: 8,
            maxRotation: 0,
            color: palette.textColor,
            font: { family: "'DM Mono', monospace", size: 10 },
          },
        },
      },
    });

    // 1. Temperature Chart
    const tempCtx = tempCanvasRef.current.getContext('2d');
    if (tempCtx) {
      const grad = tempCtx.createLinearGradient(0, 0, 0, 240);
      grad.addColorStop(0, palette.tempGradTop);
      grad.addColorStop(1, palette.tempGradBottom);

      const tempDatasets: ChartDataset<'line', (number | null)[]>[] = [
        {
          label: 'Observed',
          data: temps,
          borderColor: palette.tempLine,
          backgroundColor: grad,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.32,
          hidden: hiddenSeries.observed,
        },
      ];

      if (ensembleSeries) {
        const activeTempModels: (number | null)[][] = [];
        if (!hiddenSeries.linear) activeTempModels.push(ensembleSeries.linear.fTemp);
        if (!hiddenSeries.sma) activeTempModels.push(ensembleSeries.sma.fTemp);
        if (!hiddenSeries.ema) activeTempModels.push(ensembleSeries.ema.fTemp);

        const fanBounds = buildDynamicEnsembleFan(activeTempModels, labels.length);
        const hideFan = hiddenSeries.fan || activeTempModels.length < 2;

        tempDatasets.push(
          {
            label: 'Ensemble Fan Max',
            data: fanBounds.upper,
            borderColor: 'transparent',
            pointRadius: 0,
            fill: '+1',
            backgroundColor: palette.fanFill,
            tension: 0.32,
            order: 5,
            hidden: hideFan,
          },
          {
            label: 'Ensemble Fan Min',
            data: fanBounds.lower,
            borderColor: 'transparent',
            pointRadius: 0,
            fill: false,
            tension: 0.32,
            order: 5,
            hidden: hideFan,
          },
          {
            label: 'Linear Forecast',
            data: ensembleSeries.linear.fTemp,
            borderColor: palette.forecastGreen,
            borderWidth: 1.8,
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.linear,
          },
          {
            label: 'SMA Forecast',
            data: ensembleSeries.sma.fTemp,
            borderColor: palette.smaTempLine,
            borderWidth: 1.6,
            borderDash: [3, 3],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.sma,
          },
          {
            label: 'EMA Forecast',
            data: ensembleSeries.ema.fTemp,
            borderColor: palette.emaLine,
            borderWidth: 1.6,
            borderDash: [2, 3],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.ema,
          },
        );
      } else {
        tempDatasets.push({
          label: `Forecast (${model.toUpperCase()})`,
          data: primarySeries.fTemp,
          borderColor: palette.forecastGreen,
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.32,
          hidden: hiddenSeries.forecast,
        });
      }

      tempDatasets.push({
        label: 'YoY −1yr',
        data: histTemps,
        borderColor: palette.yoyRose,
        borderWidth: 1.2,
        borderDash: [2, 4],
        pointRadius: 0,
        tension: 0.32,
        hidden: hiddenSeries.yoy,
      });

      const tempOpts = makeBaseOptions('temp', palette.tempLine);
      if (tempChartRef.current) {
        tempChartRef.current.data = { labels, datasets: tempDatasets };
        tempChartRef.current.options = tempOpts;
        tempChartRef.current.update('none');
      } else {
        tempChartRef.current = new Chart<'line', (number | null)[], string>(tempCtx, {
          type: 'line',
          data: { labels, datasets: tempDatasets },
          options: tempOpts,
        });
      }
    }

    // 2. Wind Speed Chart
    const windCtx = windCanvasRef.current.getContext('2d');
    if (windCtx) {
      const windDatasets: ChartDataset<'bar' | 'line', (number | null)[]>[] = [
        {
          label: 'Observed',
          type: 'bar',
          data: winds,
          backgroundColor: palette.windBarBg,
          borderColor: palette.windBarBorder,
          borderWidth: 1,
          borderRadius: 2,
          barPercentage: 0.82,
          categoryPercentage: 0.9,
          hidden: hiddenSeries.observed,
        },
      ];

      if (ensembleSeries) {
        const activeWindModels: (number | null)[][] = [];
        if (!hiddenSeries.linear) activeWindModels.push(ensembleSeries.linear.fWind);
        if (!hiddenSeries.sma) activeWindModels.push(ensembleSeries.sma.fWind);
        if (!hiddenSeries.ema) activeWindModels.push(ensembleSeries.ema.fWind);

        const fanBounds = buildDynamicEnsembleFan(activeWindModels, labels.length);
        const hideFan = hiddenSeries.fan || activeWindModels.length < 2;

        windDatasets.push(
          {
            label: 'Ensemble Fan Max',
            type: 'line',
            data: fanBounds.upper,
            borderColor: 'transparent',
            pointRadius: 0,
            fill: '+1',
            backgroundColor: palette.fanFill,
            tension: 0.32,
            order: 5,
            hidden: hideFan,
          },
          {
            label: 'Ensemble Fan Min',
            type: 'line',
            data: fanBounds.lower,
            borderColor: 'transparent',
            pointRadius: 0,
            fill: false,
            tension: 0.32,
            order: 5,
            hidden: hideFan,
          },
          {
            label: 'Linear Forecast',
            type: 'line',
            data: ensembleSeries.linear.fWind,
            borderColor: palette.forecastGreen,
            borderWidth: 1.8,
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.linear,
          },
          {
            label: 'SMA Forecast',
            type: 'line',
            data: ensembleSeries.sma.fWind,
            borderColor: palette.smaWindLine,
            borderWidth: 1.6,
            borderDash: [3, 3],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.sma,
          },
          {
            label: 'EMA Forecast',
            type: 'line',
            data: ensembleSeries.ema.fWind,
            borderColor: palette.emaLine,
            borderWidth: 1.6,
            borderDash: [2, 3],
            pointRadius: 0,
            tension: 0.32,
            hidden: hiddenSeries.ema,
          },
        );
      } else {
        windDatasets.push({
          label: `Forecast (${model.toUpperCase()})`,
          type: 'line',
          data: primarySeries.fWind,
          borderColor: palette.forecastGreen,
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.32,
          hidden: hiddenSeries.forecast,
        });
      }

      windDatasets.push({
        label: 'YoY −1yr',
        type: 'line',
        data: histWinds,
        borderColor: palette.yoyRose,
        borderWidth: 1.2,
        borderDash: [2, 4],
        pointRadius: 0,
        tension: 0.32,
        hidden: hiddenSeries.yoy,
      });

      const windOpts = makeBaseOptions('wind', palette.windBeacon);
      if (windChartRef.current) {
        windChartRef.current.data = { labels, datasets: windDatasets };
        windChartRef.current.options = windOpts;
        windChartRef.current.update('none');
      } else {
        windChartRef.current = new Chart<'bar' | 'line', (number | null)[], string>(windCtx, {
          type: 'bar',
          data: { labels, datasets: windDatasets },
          options: windOpts,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewData, model, theme, units, hiddenSeries, syncHoverAcrossCharts]);

  // Smooth, CPU-friendly NOW beacon pulse redraw (~12fps)
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      tempChartRef.current?.draw();
      windChartRef.current?.draw();
    }, 85);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Cleanup chart instances on unmount
  useEffect(() => {
    return () => {
      tempChartRef.current?.destroy();
      windChartRef.current?.destroy();
      tempChartRef.current = null;
      windChartRef.current = null;
    };
  }, []);

  const palette = getThemePalette(theme);
  const tempUnit = units.temp === 'C' ? '°C' : '°F';
  const windUnit = units.wind === 'kmh' ? 'km/h' : 'm/s';
  const rangeText = viewData
    ? `${viewData.obsHours}h Obs ← [NOW] → ${viewData.horizon}h Fcst (${viewData.tzLabel})`
    : '96h Obs ← [NOW] → 48h Fcst';
  const fullRangeTooltip = viewData
    ? `${viewData.obsHours}h Observed ← [NOW] → ${viewData.horizon}h Forecast · Central European Time (${viewData.tzLabel})`
    : '96h Observed ← [NOW] → 48h Forecast';

  const isEnsemble = model === 'ensemble';

  const renderLegendButtons = (variant: 'temp' | 'wind') => {
    const observedColor = variant === 'temp' ? palette.tempLine : palette.windBeacon;
    const smaColor = variant === 'temp' ? palette.smaTempLine : palette.smaWindLine;

    const items: {
      key: SeriesKey;
      label: string;
      swatchType: 'solid' | 'dashed' | 'band';
      color: string;
    }[] = [
      { key: 'observed', label: 'Observed', swatchType: 'solid', color: observedColor },
      ...(isEnsemble
        ? [
            {
              key: 'linear' as const,
              label: 'Linear',
              swatchType: 'dashed' as const,
              color: palette.forecastGreen,
            },
            {
              key: 'sma' as const,
              label: 'SMA',
              swatchType: 'dashed' as const,
              color: smaColor,
            },
            {
              key: 'ema' as const,
              label: 'EMA',
              swatchType: 'dashed' as const,
              color: palette.emaLine,
            },
            {
              key: 'fan' as const,
              label: 'Spread',
              swatchType: 'band' as const,
              color: palette.fanFill,
            },
          ]
        : [
            {
              key: 'forecast' as const,
              label: `Forecast (${model.toUpperCase()})`,
              swatchType: 'dashed' as const,
              color: palette.forecastGreen,
            },
          ]),
      { key: 'yoy', label: 'YoY −1yr', swatchType: 'dashed', color: palette.yoyRose },
    ];

    return (
      <div
        className="legend-cluster"
        role="group"
        aria-label={`${variant === 'temp' ? 'Temperature' : 'Wind speed'} series toggles`}
      >
        {items.map((item) => {
          const isMuted = hiddenSeries[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`leg-pill leg-toggle ${isMuted ? 'muted' : ''}`}
              aria-pressed={!isMuted}
              onClick={() => toggleSeries(item.key)}
            >
              {item.swatchType === 'solid' && (
                <span className="leg-swatch" style={{ background: item.color }} />
              )}
              {item.swatchType === 'dashed' && (
                <span className="leg-swatch dashed" style={{ color: item.color }} />
              )}
              {item.swatchType === 'band' && (
                <span
                  className="leg-swatch band"
                  style={{
                    background: item.color,
                    borderColor: palette.fanSwatchBorder,
                  }}
                />
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const hoveredTimeLabel =
    hoverIndex !== null && viewData?.labels?.[hoverIndex] ? viewData.labels[hoverIndex] : null;

  return (
    <section
      className="charts-deck"
      aria-label="Synchronized Temporal Horizon Charts"
      data-hover-index={hoverIndex ?? ''}
    >
      <div className="horizon-card">
        <div className="horizon-card-header">
          <div className="horizon-title-cluster">
            <span className="horizon-tag">Temperature {tempUnit}</span>
            <span
              className="horizon-range-badge"
              title={hoveredTimeLabel ? `Synced Cursor · ${hoveredTimeLabel}` : fullRangeTooltip}
            >
              {hoveredTimeLabel ? `Synced Cursor · ${hoveredTimeLabel}` : rangeText}
            </span>
          </div>
          {renderLegendButtons('temp')}
        </div>
        <div
          className="canvas-container"
          onMouseLeave={() => syncHoverAcrossCharts('temp', null)}
        >
          <canvas ref={tempCanvasRef} aria-label={`Temperature chart in ${tempUnit}`} />
        </div>
      </div>

      <div className="horizon-card">
        <div className="horizon-card-header">
          <div className="horizon-title-cluster">
            <span className="horizon-tag">Wind Speed {windUnit}</span>
            <span
              className="horizon-range-badge"
              title={
                hoveredTimeLabel
                  ? `Synced Cursor · ${hoveredTimeLabel}`
                  : '10m Anemometer + Forecast Trajectory · ☾ Local Night'
              }
            >
              {hoveredTimeLabel
                ? `Synced Cursor · ${hoveredTimeLabel}`
                : '10m Wind + Forecast · ☾ Local Night'}
            </span>
          </div>
          {renderLegendButtons('wind')}
        </div>
        <div
          className="canvas-container"
          onMouseLeave={() => syncHoverAcrossCharts('wind', null)}
        >
          <canvas ref={windCanvasRef} aria-label={`Wind speed chart in ${windUnit}`} />
        </div>
      </div>
    </section>
  );
}
