"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTickerStore } from "@/lib/stores/tickerStore";
import { fetchCompanyNews, newsKeys } from "@/lib/queries/market";
import type { NewsItem } from "@alpha/types";

interface NewsFeedPanelProps {
  panelId: string;
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2 rounded hover:bg-accent transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-medium leading-snug line-clamp-3 group-hover:text-primary transition-colors">
            {item.headline}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{item.source}</span>
            <span>·</span>
            <span>{formatDate(item.datetime)}</span>
          </div>
        </div>
        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </a>
  );
}

export function NewsFeedPanel({ panelId }: NewsFeedPanelProps) {
  // Subscribe only to activeTicker — refreshes within 1 render cycle of ticker change
  const activeTicker = useTickerStore((s) => s.activeTicker);

  const today = new Date().toISOString().split("T")[0]!;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .split("T")[0]!;

  const { data: news, isLoading, error } = useQuery({
    queryKey: newsKeys.ticker(activeTicker ?? "", weekAgo, today),
    queryFn: () => fetchCompanyNews(activeTicker!, weekAgo, today),
    enabled: !!activeTicker,
    staleTime: 120_000, // 2 min — matches server cache TTL
  });

  if (!activeTicker) {
    return (
      <div
        className="flex items-center justify-center h-full text-sm text-muted-foreground"
        data-panel-id={panelId}
      >
        Click a ticker in your watchlist to see news
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 h-full" data-panel-id={panelId}>
      <div className="flex items-center justify-between shrink-0 pb-1 border-b">
        <span className="text-xs font-medium text-muted-foreground">
          News for{" "}
          <span className="font-mono font-semibold text-foreground">
            {activeTicker}
          </span>
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          Loading news…
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive p-2">
          Failed to load news. Please try again.
        </div>
      )}

      {!isLoading && !error && (!news || news.length === 0) && (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          No recent news for {activeTicker}
        </div>
      )}

      {!isLoading && !error && news && news.length > 0 && (
        <div className="flex-1 overflow-auto space-y-0.5">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
