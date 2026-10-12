"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fundamentalsKeys, fetchStockFinancials } from "@/lib/queries/fundamentals";

interface IcConcept {
  concept: string;
  value: number | null;
  unit?: string;
  label?: string;
}

interface ReportPeriod {
  report: { ic: IcConcept[] };
  quarter: number;
  year: number;
}

interface FinancialsData {
  data: ReportPeriod[];
  symbol: string;
}

interface FundamentalsFinancialsProps {
  symbol: string;
}

const LINE_ITEMS: Array<{ concept: string; label: string }> = [
  { concept: "Revenues", label: "Revenue" },
  { concept: "OperatingIncomeLoss", label: "Op. Income" },
  { concept: "NetIncomeLoss", label: "Net Income" },
  { concept: "EarningsPerShareBasic", label: "EPS (Basic)" },
];

function findConcept(ic: IcConcept[], concept: string): string {
  const item = ic.find((c) => c.concept === concept);
  if (!item || item.value == null) return "—";
  const abs = Math.abs(item.value);
  const sign = item.value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${item.value.toFixed(2)}`;
}

export function FundamentalsFinancials({ symbol }: FundamentalsFinancialsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: fundamentalsKeys.financials(symbol),
    queryFn: () => fetchStockFinancials(symbol),
    staleTime: 86_400_000,
    retry: 1,
    enabled: !!symbol,
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  const raw = data as FinancialsData | null | undefined;
  const periods = raw?.data?.slice(0, 4) ?? [];

  if (isError || periods.length === 0) {
    return <p className="text-xs text-muted-foreground">No data available</p>;
  }

  const cols = [...periods].reverse();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left text-muted-foreground pr-2 font-normal pb-1">Metric</th>
            {cols.map((p) => (
              <th key={`${p.year}-${p.quarter}`} className="text-right text-muted-foreground font-normal pb-1 pl-2 whitespace-nowrap">
                {p.year}Q{p.quarter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LINE_ITEMS.map(({ concept, label }) => (
            <tr key={concept} className="border-t border-border/50">
              <td className="text-muted-foreground pr-2 py-0.5">{label}</td>
              {cols.map((p, i) => (
                <td key={i} className="text-right font-mono pl-2 py-0.5 tabular-nums">
                  {findConcept(p.report.ic ?? [], concept)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
