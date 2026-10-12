"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fundamentalsKeys, fetchStockMetric } from "@/lib/queries/fundamentals";

interface FundamentalsMetricsProps {
  symbol: string;
}

type MetricRecord = Record<string, number | string | null | undefined>;

function fmt(v: number | string | null | undefined, decimals = 2): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function fmtPct(v: number | string | null | undefined): string {
  const s = fmt(v);
  return s === "—" ? "—" : `${s}%`;
}

export function FundamentalsMetrics({ symbol }: FundamentalsMetricsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: fundamentalsKeys.metric(symbol),
    queryFn: () => fetchStockMetric(symbol),
    staleTime: 86_400_000,
    retry: 1,
    enabled: !!symbol,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  const isEmpty = isError || !data;
  if (isEmpty) {
    return <p className="text-xs text-muted-foreground">No data available</p>;
  }

  const m = (data as { metric: MetricRecord }).metric ?? (data as MetricRecord);

  const rows: Array<{ label: string; value: string }> = [
    { label: "P/E (TTM)", value: fmt(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peExclExtraTTM) },
    { label: "P/S (TTM)", value: fmt(m.psTTM ?? m["ps"]) },
    { label: "P/B", value: fmt(m.pbQuarterly ?? m["pb"]) },
    { label: "EV/EBITDA (TTM)", value: fmt(m.enterpriseValueMultipleTTM ?? m["ev/ebitda"]) },
    { label: "52W High", value: fmt(m["52WeekHigh"]) },
    { label: "52W Low", value: fmt(m["52WeekLow"]) },
    { label: "Beta", value: fmt(m.beta) },
    { label: "Div Yield", value: fmtPct(m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual) },
    { label: "Gross Margin", value: fmtPct(m.grossMarginTTM) },
    { label: "Op Margin", value: fmtPct(m.operatingMarginTTM) },
    { label: "Net Margin", value: fmtPct(m.netProfitMarginTTM) },
    {
      label: "Debt/Equity",
      value: fmt(
        m["longTermDebt/equityQuarterly"] ??
        m["totalDebt/totalEquityQuarterly"] ??
        m.debtToEquity
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-muted-foreground truncate">{label}</span>
          <span className="font-mono font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}
