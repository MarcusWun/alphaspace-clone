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
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { fundamentalsKeys, fetchStockRecommendation } from "@/lib/queries/fundamentals";

interface RecommendationItem {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

interface FundamentalsRecommendationsProps {
  symbol: string;
}

export function FundamentalsRecommendations({ symbol }: FundamentalsRecommendationsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: fundamentalsKeys.recommendation(symbol),
    queryFn: () => fetchStockRecommendation(symbol),
    staleTime: 86_400_000,
    retry: 1,
    enabled: !!symbol,
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const raw = data as RecommendationItem[] | null | undefined;
  const isEmpty = isError || !raw || !Array.isArray(raw) || raw.length === 0;
  if (isEmpty) {
    return <p className="text-xs text-muted-foreground">No data available</p>;
  }

  const chartData = raw
    .slice(0, 6)
    .reverse()
    .map((item) => ({
      period: item.period?.slice(0, 7) ?? "",
      strongBuy: item.strongBuy ?? 0,
      buy: item.buy ?? 0,
      hold: item.hold ?? 0,
      sell: item.sell ?? 0,
      strongSell: item.strongSell ?? 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="period" tick={{ fontSize: 9 }} tickLine={false} />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 11, backgroundColor: "#1e293b", border: "none" }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="strongBuy" name="Strong Buy" stackId="a" fill="#166534" />
        <Bar dataKey="buy" name="Buy" stackId="a" fill="#22c55e" />
        <Bar dataKey="hold" name="Hold" stackId="a" fill="#f59e0b" />
        <Bar dataKey="sell" name="Sell" stackId="a" fill="#ef4444" />
        <Bar dataKey="strongSell" name="Strong Sell" stackId="a" fill="#991b1b" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
