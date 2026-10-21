"use client";

import { useEffect, useRef, useMemo, useState, memo } from "react";
import { useSavePanelConfig } from "@/lib/hooks/useSavePanelConfig";
import { useCandles } from "@/lib/queries/useCandles";
import { useQuote } from "@/lib/queries/useQuote";
import { timeRangeToResolution, bucketedWindowForTimeRange } from "@/lib/queries/market";
import { useTickerStore } from "@/lib/stores/tickerStore";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeRange, CandleData } from "@alpha/types";

const DEFAULT_SYMBOL = "NVDA";
const DEFAULT_TIME_RANGE: TimeRange = "6M";

const STOCK_CHART_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"];

// ── Volume + OHLC chart renderer ──────────────────────────────────────────────
const StockLightweightChart = memo(function StockLightweightChart({
  candles,
  chartType,
}: {
  candles: CandleData;
  chartType: "line" | "candles";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const mainSeriesRef = useRef<unknown>(null);
  const volumeSeriesRef = useRef<unknown>(null);
  const prevChartTypeRef = useRef<"line" | "candles">(chartType);

  useEffect(() => {
    if (!containerRef.current) return;

    let chart: ReturnType<typeof import("lightweight-charts")["createChart"]> | null = null;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (!containerRef.current || chartRef.current) return;

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
    });

    return () => {
      chart?.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (candles.s !== "ok" || !candles.t.length) return;

    import("lightweight-charts").then(({ LineSeries, CandlestickSeries, HistogramSeries }) => {
      const chart = chartRef.current as ReturnType<typeof import("lightweight-charts")["createChart"]> | null;
      if (!chart) return;

      const chartTypeChanged = prevChartTypeRef.current !== chartType;
      if (chartTypeChanged) {
        prevChartTypeRef.current = chartType;
        if (mainSeriesRef.current) {
          // @ts-expect-error lightweight-charts removeSeries
          chart.removeSeries(mainSeriesRef.current);
          mainSeriesRef.current = null;
        }
      }

      if (!mainSeriesRef.current) {
        if (chartType === "candles") {
          mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#22c55e",
            downColor: "#ef4444",
            borderVisible: false,
            wickUpColor: "#22c55e",
            wickDownColor: "#ef4444",
            priceScaleId: "right",
          });
        } else {
          mainSeriesRef.current = chart.addSeries(LineSeries, {
            color: "#3b82f6",
            lineWidth: 2 as import("lightweight-charts").LineWidth,
            priceScaleId: "right",
          });
        }
      }

      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          color: "#475569",
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
      }

      const mainSeries = mainSeriesRef.current as { setData: (d: unknown) => void } | null;
      const volSeries = volumeSeriesRef.current as { setData: (d: unknown) => void } | null;

      if (chartType === "candles") {
        const ohlcData = candles.t.map((t, i) => ({
          time: t as import("lightweight-charts").Time,
          open: candles.o[i] ?? 0,
          high: candles.h[i] ?? 0,
          low: candles.l[i] ?? 0,
          close: candles.c[i] ?? 0,
        }));
        mainSeries?.setData(ohlcData);
      } else {
        const lineData = candles.t.map((t, i) => ({
          time: t as import("lightweight-charts").Time,
          value: candles.c[i] ?? 0,
        }));
        mainSeries?.setData(lineData);
      }

      const volData = candles.t.map((t, i) => {
        const close = candles.c[i] ?? 0;
        const open = candles.o[i] ?? 0;
        return {
          time: t as import("lightweight-charts").Time,
          value: candles.v[i] ?? 0,
          color: close >= open ? "#22c55e33" : "#ef444433",
        };
      });
      volSeries?.setData(volData);

      chart.timeScale().fitContent();
    });
  }, [candles, chartType]);

  return <div ref={containerRef} className="w-full h-full" />;
});

// ── Main panel ─────────────────────────────────────────────────────────────────
interface StockChartPanelProps {
  panelId: string;
  symbol?: string;
  chartType?: "line" | "candles";
}

export function StockChartPanel({
  panelId,
  symbol: symbolProp,
  chartType = "line",
}: StockChartPanelProps) {
  const activeTicker = useTickerStore((s) => s.activeTicker);
  const effectiveSymbol = activeTicker ?? symbolProp ?? DEFAULT_SYMBOL;

  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);

  // Persistence: save activeTicker + timeRange back to workspace on change
  const save = useSavePanelConfig(panelId);
  const isMountRef = useRef(true);
  useEffect(() => {
    if (isMountRef.current) {
      isMountRef.current = false;
      return;
    }
    save({ activeTicker: effectiveSymbol, timeRange });
  }, [effectiveSymbol, timeRange]); // save intentionally omitted (stable ref via useMemo)

  const resolution = useMemo(() => timeRangeToResolution(timeRange), [timeRange]);

  const { from, to } = useMemo(
    () => bucketedWindowForTimeRange(timeRange),
    [timeRange]
  );

  const { data: candles, isLoading: candlesLoading, rateLimited } = useCandles(
    effectiveSymbol,
    resolution,
    from,
    to
  );

  const { data: quote, isLoading: quoteLoading } = useQuote(effectiveSymbol);

  const priceColor = quote && quote.d >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="flex flex-col gap-2 h-full" data-panel-id={panelId}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <span className="font-semibold text-sm">{effectiveSymbol}</span>
        {quoteLoading ? (
          <Skeleton className="h-4 w-24" />
        ) : quote ? (
          <div className={`flex items-baseline gap-1.5 text-xs font-mono ${priceColor}`}>
            <span className="text-base font-semibold text-foreground">
              ${quote.c.toFixed(2)}
            </span>
            <span>
              {quote.d >= 0 ? "+" : ""}
              {quote.d.toFixed(2)}
            </span>
            <span>
              ({quote.dp >= 0 ? "+" : ""}
              {quote.dp.toFixed(2)}%)
            </span>
          </div>
        ) : null}
      </div>

      {/* Resolution switcher */}
      <div className="flex items-center gap-1 flex-wrap shrink-0">
        {STOCK_CHART_RANGES.map((range) => (
          <button
            key={range}
            aria-label={`Set time range ${range}`}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              timeRange === range
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            onClick={() => setTimeRange(range)}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Rate-limit banner */}
      {rateLimited && (
        <div
          className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-2 py-1 shrink-0"
          data-testid="rate-limited-banner"
        >
          Chart data temporarily unavailable (rate-limited). Try again in a few minutes.
        </div>
      )}

      {/* Loading */}
      {candlesLoading && !rateLimited && (
        <p className="text-xs text-muted-foreground shrink-0">Loading chart data…</p>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {candles && candles.s === "ok" ? (
          <StockLightweightChart candles={candles} chartType={chartType} />
        ) : !candlesLoading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No chart data available
          </div>
        ) : null}
      </div>
    </div>
  );
}
