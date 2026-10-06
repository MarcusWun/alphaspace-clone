"use client";

import { useEffect, useRef, useState, useCallback, memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useTickerStore } from "@/lib/stores/tickerStore";
import {
  fetchCandles,
  timeRangeToUnix,
  timeRangeToResolution,
  candleKeys,
} from "@/lib/queries/market";
import { candleQueryConfig } from "@/lib/queries/useCandles";
import type { CandleData, TimeRange } from "@alpha/types";

// ── Series colours ────────────────────────────────────────────────────────────
const COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
];

const TIME_RANGES: TimeRange[] = ["1W", "1M", "3M", "YTD", "1Y", "5Y", "custom"];

// ── Normalisation helper (line mode — % change from first close) ──────────────
function normalizeCandles(
  candles: CandleData
): Array<{ time: number; value: number }> {
  if (candles.s !== "ok" || !candles.t.length) return [];
  const first = candles.c[0] ?? 1;
  return candles.t.map((t, i) => ({
    time: t,
    value: (((candles.c[i] ?? 0) - first) / first) * 100,
  }));
}

// ── Forward-fill helper ───────────────────────────────────────────────────────
function forwardFill(
  series: Array<{ time: number; value: number }>,
  allTimes: number[]
): Array<{ time: number; value: number }> {
  if (!series.length) return allTimes.map((t) => ({ time: t, value: 0 }));
  const map = new Map(series.map((p) => [p.time, p.value]));
  let last = 0;
  return allTimes.map((t) => {
    if (map.has(t)) last = map.get(t)!;
    return { time: t, value: last };
  });
}

// ── OHLC helper (candle mode) ─────────────────────────────────────────────────
function buildOhlcData(
  candles: CandleData
): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  if (candles.s !== "ok" || !candles.t.length) return [];
  return candles.t.map((t, i) => ({
    time: t,
    open: candles.o[i] ?? 0,
    high: candles.h[i] ?? 0,
    low: candles.l[i] ?? 0,
    close: candles.c[i] ?? 0,
  }));
}

// ── Series data type ──────────────────────────────────────────────────────────
interface SeriesEntry {
  ticker: string;
  /** Normalised % change from first close — used in line mode */
  lineData: Array<{ time: number; value: number }>;
  /** Raw OHLC — used in candle mode (single-ticker only) */
  ohlcData: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  color: string;
}

// ── Chart renderer (imperative TradingView Lightweight Charts) ─────────────────
const LightweightChart = memo(function LightweightChart({
  seriesData,
  chartType,
}: {
  seriesData: SeriesEntry[];
  chartType: "line" | "candles";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const seriesRefs = useRef<Map<string, unknown>>(new Map());
  const prevChartTypeRef = useRef<"line" | "candles">(chartType);

  // Initialise chart once
  useEffect(() => {
    if (!containerRef.current) return;

    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!containerRef.current || chartRef.current) return;

      performance.mark("chart-init-start");

      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#94a3b8",
        },
        grid: {
          vertLines: { color: "#1e293b" },
          horzLines: { color: "#1e293b" },
        },
        rightPriceScale: { borderColor: "#334155" },
        timeScale: { borderColor: "#334155", timeVisible: true },
        crosshair: {
          vertLine: { color: "#475569" },
          horzLine: { color: "#475569" },
        },
      });

      chartRef.current = chart;

      performance.mark("chart-init-end");
      performance.measure("chart-init", "chart-init-start", "chart-init-end");

      const m = performance.getEntriesByName("chart-init").at(-1);
      if (m) console.log(`[Alpha] chart init: ${m.duration.toFixed(1)}ms`);
    });

    return () => {
      chart?.remove();
      chartRef.current = null;
      seriesRefs.current.clear();
    };
  }, []);

  // Sync series data whenever seriesData or chartType changes
  useEffect(() => {
    import("lightweight-charts").then(({ LineSeries, CandlestickSeries }) => {
      const chart = chartRef.current as ReturnType<
        typeof import("lightweight-charts")["createChart"]
      > | null;
      if (!chart) return;

      const chartTypeChanged = prevChartTypeRef.current !== chartType;
      if (chartTypeChanged) {
        prevChartTypeRef.current = chartType;
        // Remove all series — they are the wrong type for the new mode
        for (const series of seriesRefs.current.values()) {
          // @ts-expect-error lightweight-charts removeSeries is not typed on the chart object directly
          chart.removeSeries(series);
        }
        seriesRefs.current.clear();
      }

      const currentTickers = new Set(seriesData.map((s) => s.ticker));
      const prevTickers = new Set(seriesRefs.current.keys());

      // Remove stale series (ticker removed from chart)
      for (const ticker of prevTickers) {
        if (!currentTickers.has(ticker)) {
          const series = seriesRefs.current.get(ticker);
          if (series) {
            // @ts-expect-error lightweight-charts removeSeries is not typed on the chart object directly
            chart.removeSeries(series);
            seriesRefs.current.delete(ticker);
          }
        }
      }

      // Add new / update existing series
      seriesData.forEach(({ ticker, lineData, ohlcData, color }) => {
        if (chartType === "line") {
          const sorted = [...lineData].sort((a, b) => a.time - b.time);
          const mapped = sorted.map((p) => ({
            time: p.time as import("lightweight-charts").Time,
            value: p.value,
          }));

          if (seriesRefs.current.has(ticker)) {
            const existing = seriesRefs.current.get(ticker) as
              | { setData: (d: unknown) => void }
              | undefined;
            existing?.setData(mapped);
          } else {
            const newSeries = chart.addSeries(LineSeries, {
              color,
              lineWidth: 2 as import("lightweight-charts").LineWidth,
              title: ticker,
              priceFormat: { type: "percent", precision: 2, minMove: 0.01 },
            });
            if (mapped.length > 0) newSeries.setData(mapped);
            seriesRefs.current.set(ticker, newSeries);
          }
        } else {
          // Candles mode — raw OHLC
          const sorted = [...ohlcData].sort((a, b) => a.time - b.time);
          const mapped = sorted.map((p) => ({
            time: p.time as import("lightweight-charts").Time,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
          }));

          if (seriesRefs.current.has(ticker)) {
            const existing = seriesRefs.current.get(ticker) as
              | { setData: (d: unknown) => void }
              | undefined;
            existing?.setData(mapped);
          } else {
            const newSeries = chart.addSeries(CandlestickSeries, {
              upColor: "#22c55e",
              downColor: "#ef4444",
              borderVisible: false,
              wickUpColor: "#22c55e",
              wickDownColor: "#ef4444",
              title: ticker,
            });
            if (mapped.length > 0) newSeries.setData(mapped);
            seriesRefs.current.set(ticker, newSeries);
          }
        }
      });

      if (seriesData.length > 0) chart.timeScale().fitContent();
    });
  }, [seriesData, chartType]);

  return <div ref={containerRef} className="w-full h-full" />;
});

// ── Main panel component ───────────────────────────────────────────────────────
interface ComparisonChartPanelProps {
  panelId: string;
  tickers: string[];
  timeRange: string;
  /** unix seconds — persisted in workspace layout for custom range survival across reload */
  customFrom?: number;
  customTo?: number;
  /** Workspace-level chart type preference; ignored for multi-ticker (forced to line) */
  chartType?: "line" | "candles";
}

export function ComparisonChartPanel({
  panelId,
  tickers: initialTickers,
  timeRange: initialTimeRange,
  customFrom: initialCustomFrom,
  customTo: initialCustomTo,
  chartType = "line",
}: ComparisonChartPanelProps) {
  const [chartTickers, setChartTickers] = useState<string[]>(initialTickers);
  const [timeRange, setTimeRange] = useState<TimeRange>(
    (initialTimeRange as TimeRange) ?? "1Y"
  );
  const [newTicker, setNewTicker] = useState("");

  // Custom date range state — ISO date strings for <input type="date">
  const [customFromDate, setCustomFromDate] = useState<string>(() =>
    initialCustomFrom
      ? new Date(initialCustomFrom * 1000).toISOString().slice(0, 10)
      : ""
  );
  const [customToDate, setCustomToDate] = useState<string>(() =>
    initialCustomTo
      ? new Date(initialCustomTo * 1000).toISOString().slice(0, 10)
      : ""
  );

  // Subscribe only to activeTimeRange from the store
  const storeTimeRange = useTickerStore((s) => s.activeTimeRange);
  const setActiveTimeRange = useTickerStore((s) => s.setActiveTimeRange);

  // Sync store time range to local state
  useEffect(() => {
    setTimeRange(storeTimeRange);
  }, [storeTimeRange]);

  // Multi-ticker rule: ≥2 tickers forces line regardless of workspace chartType
  const effectiveChartType: "line" | "candles" =
    chartTickers.length >= 2 ? "line" : chartType;
  const candlesForced = chartTickers.length >= 2 && chartType === "candles";

  // Resolve query params — memoised so queryKey stays stable across re-renders.
  // Without useMemo, timeRangeToUnix() calls Date.now() on every render, changing
  // `from`/`to` each second and creating a new queryKey — breaking dedup and
  // preventing retry exhaustion (CANDLES-FE-RETRY-STORM).
  const { from, to } = useMemo(() => {
    const customFromTs = customFromDate
      ? Math.floor(new Date(customFromDate).getTime() / 1000)
      : 0;
    const customToTs = customToDate
      ? Math.floor(new Date(customToDate).getTime() / 1000)
      : 0;
    return timeRange === "custom" && customFromTs > 0 && customToTs > 0
      ? { from: customFromTs, to: customToTs }
      : timeRangeToUnix(timeRange);
  }, [timeRange, customFromDate, customToDate]);
  const resolution = useMemo(() => timeRangeToResolution(timeRange), [timeRange]);

  // useQueries is a single hook call — safe to use with a dynamic array.
  // Each ticker has its own stable query key so removing one DOES NOT
  // invalidate the others (survivors are served from cache, no re-fetch).
  const results = useQueries({
    queries: chartTickers.map((ticker) => ({
      queryKey: candleKeys.ticker(ticker, resolution, from, to),
      queryFn: () => {
        performance.mark(`candle-fetch-start-${ticker}`);
        return fetchCandles(ticker, resolution, from, to).then((data) => {
          performance.mark(`candle-fetch-end-${ticker}`);
          performance.measure(
            `candle-fetch-${ticker}`,
            `candle-fetch-start-${ticker}`,
            `candle-fetch-end-${ticker}`
          );
          return data;
        });
      },
      enabled: !!ticker,
      ...candleQueryConfig,
    })),
  });

  // Build merged time axis for forward-filling (line mode)
  const allTimes = Array.from(
    new Set(
      results.flatMap((r) => {
        const d = r.data;
        return d?.s === "ok" ? d.t : [];
      })
    )
  ).sort((a, b) => a - b);

  // Build series data for the chart
  const seriesData: SeriesEntry[] = chartTickers
    .map((ticker, i) => {
      const r = results[i];
      if (!r?.data || r.data.s !== "ok") return null;
      const normalized = normalizeCandles(r.data);
      const filled = forwardFill(normalized, allTimes);
      const ohlc = buildOhlcData(r.data);
      return {
        ticker,
        lineData: filled,
        ohlcData: ohlc,
        color: COLORS[i % COLORS.length] ?? "#3b82f6",
      };
    })
    .filter((s): s is SeriesEntry => s !== null);

  const handleAddTicker = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const ticker = newTicker.trim().toUpperCase();
      if (!ticker || chartTickers.includes(ticker)) return;
      setChartTickers((prev) => [...prev, ticker]);
      setNewTicker("");
    },
    [newTicker, chartTickers]
  );

  const handleRemoveTicker = useCallback((ticker: string) => {
    setChartTickers((prev) => prev.filter((t) => t !== ticker));
  }, []);

  const handleTimeRangeClick = useCallback(
    (range: TimeRange) => {
      setTimeRange(range);
      setActiveTimeRange(range);
    },
    [setActiveTimeRange]
  );

  const anyLoading = results.some((r) => r.isLoading);
  // "Permanent error" = isError set and not currently retrying
  const anyPermanentError = results.some((r) => r.isError && !r.isFetching);

  const handleRetryAll = useCallback(() => {
    results.forEach((r) => {
      if (r.isError) r.refetch();
    });
  }, [results]);

  return (
    <div className="flex flex-col gap-2 h-full" data-panel-id={panelId}>
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {/* Time range selector */}
        <div className="flex items-center gap-1 flex-wrap">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                timeRange === range
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              onClick={() => handleTimeRangeClick(range)}
            >
              {range === "custom" ? "Custom" : range}
            </button>
          ))}
          {timeRange === "custom" && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
                className="h-6 px-1.5 text-xs rounded border border-input bg-background text-foreground"
                aria-label="Custom range start date"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                className="h-6 px-1.5 text-xs rounded border border-input bg-background text-foreground"
                aria-label="Custom range end date"
              />
            </div>
          )}
        </div>

        {/* Multi-ticker candles-disabled indicator */}
        {candlesForced && (
          <span
            className="text-xs text-muted-foreground/60 border border-dashed border-muted-foreground/30 rounded px-1.5 py-0.5"
            title="Candles only available for single-ticker charts"
            aria-label="Candles disabled for multi-ticker charts"
            data-testid="candles-disabled-badge"
          >
            Line only
          </span>
        )}

        {/* Ticker chips */}
        <div className="flex flex-wrap gap-1">
          {chartTickers.map((ticker, i) => (
            <Badge
              key={ticker}
              style={{ backgroundColor: COLORS[i % COLORS.length], color: "#fff" }}
              className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs cursor-default"
            >
              {ticker}
              <button
                onClick={() => handleRemoveTicker(ticker)}
                className="ml-0.5 hover:opacity-70 transition-opacity"
                aria-label={`Remove ${ticker} from chart`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>

        {/* Add ticker */}
        <form onSubmit={handleAddTicker} className="flex gap-1">
          <Input
            placeholder="Add ticker"
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            className="h-7 w-24 text-xs uppercase"
            maxLength={10}
            aria-label="Add ticker to chart"
          />
          <Button type="submit" size="icon" className="h-7 w-7">
            <Plus className="h-3 w-3" />
          </Button>
        </form>
      </div>

      {anyPermanentError && (
        <div
          className="flex items-center gap-2 text-xs text-destructive shrink-0"
          data-testid="chart-error-state"
        >
          <span>Chart data unavailable</span>
          <button
            onClick={handleRetryAll}
            className="underline hover:no-underline focus:outline-none focus:ring-1 focus:ring-destructive rounded"
            aria-label="Retry loading chart data"
          >
            Retry
          </button>
        </div>
      )}
      {anyLoading && !anyPermanentError && (
        <p className="text-xs text-muted-foreground shrink-0">Loading chart data…</p>
      )}

      {/* Legend */}
      {seriesData.length > 0 && (
        <div className="flex flex-wrap gap-3 shrink-0">
          {seriesData.map(({ ticker, color }) => (
            <div key={ticker} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5 rounded"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs font-mono">{ticker}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {chartTickers.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Add tickers to compare performance
          </div>
        ) : (
          <LightweightChart
            seriesData={seriesData}
            chartType={effectiveChartType}
          />
        )}
      </div>
    </div>
  );
}
