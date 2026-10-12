"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { fundamentalsKeys, fetchStockEarnings } from "@/lib/queries/fundamentals";

interface EarningsItem {
  actual: number | null;
  estimate: number | null;
  period: string;
  surprise?: number;
}

interface FundamentalsEarningsProps {
  symbol: string;
}

export function FundamentalsEarnings({ symbol }: FundamentalsEarningsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: fundamentalsKeys.earnings(symbol),
    queryFn: () => fetchStockEarnings(symbol),
    staleTime: 86_400_000,
    retry: 1,
    enabled: !!symbol,
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const raw = data as EarningsItem[] | null | undefined;
  const isEmpty = isError || !raw || !Array.isArray(raw) || raw.length === 0;
  if (isEmpty) {
    return <p className="text-xs text-muted-foreground">No data available</p>;
  }

  const chartData = raw
    .slice(0, 8)
    .reverse()
    .map((item) => ({
      period: item.period?.slice(0, 7) ?? "",
      estimate: item.estimate ?? 0,
      actual: item.actual ?? 0,
      beat: (item.actual ?? 0) >= (item.estimate ?? 0),
    }));

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="period" tick={{ fontSize: 9 }} tickLine={false} />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 11, backgroundColor: "#1e293b", border: "none" }}
          formatter={(value) => (typeof value === "number" ? value.toFixed(2) : value)}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="estimate" name="Est" fill="#475569" radius={[2, 2, 0, 0]} />
        <Bar dataKey="actual" name="Act" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.beat ? "#22c55e" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
