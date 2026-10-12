"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fundamentalsKeys, fetchStockFilings } from "@/lib/queries/fundamentals";

interface FilingItem {
  form?: string;
  filedDate?: string;
  reportUrl?: string;
  filingURL?: string;
  accessNumber?: string;
}

interface FundamentalsFilingsProps {
  symbol: string;
}

export function FundamentalsFilings({ symbol }: FundamentalsFilingsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: fundamentalsKeys.filings(symbol),
    queryFn: () => fetchStockFilings(symbol, 10),
    staleTime: 21_600_000,
    retry: 1,
    enabled: !!symbol,
  });

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const raw = data as FilingItem[] | null | undefined;
  const filings = Array.isArray(raw) ? raw.slice(0, 10) : [];

  if (isError || filings.length === 0) {
    return <p className="text-xs text-muted-foreground">No data available</p>;
  }

  return (
    <div className="space-y-1">
      {filings.map((f, i) => {
        const url = f.reportUrl ?? f.filingURL;
        return (
          <div key={i} className="flex items-center justify-between gap-2 text-xs py-0.5 border-b border-border/40 last:border-0">
            <span className="font-medium shrink-0">{f.form ?? "—"}</span>
            <span className="text-muted-foreground flex-1 truncate">{f.filedDate ?? "—"}</span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline shrink-0"
                aria-label={`View ${f.form} filing from ${f.filedDate}`}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
