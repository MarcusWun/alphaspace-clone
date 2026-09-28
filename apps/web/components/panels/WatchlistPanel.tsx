"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTickerStore } from "@/lib/stores/tickerStore";
import {
  fetchWatchlists,
  updateWatchlist,
  createWatchlist,
  watchlistKeys,
  type Watchlist,
} from "@/lib/queries/watchlists";
import { cn } from "@/lib/utils";

interface WatchlistPanelProps {
  panelId: string;
  tickers?: string[];
}

export function WatchlistPanel({ panelId }: WatchlistPanelProps) {
  // Subscribe only to setActiveTicker — avoid full-store re-renders
  const activeTicker = useTickerStore((s) => s.activeTicker);
  const setActiveTicker = useTickerStore((s) => s.setActiveTicker);

  const queryClient = useQueryClient();
  const [newTicker, setNewTicker] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const { data: watchlists, isLoading, error } = useQuery({
    queryKey: watchlistKeys.all,
    queryFn: fetchWatchlists,
  });

  // Use first watchlist; create one if none exist
  const watchlist: Watchlist | undefined = watchlists?.[0];

  const ensureWatchlistMutation = useMutation({
    mutationFn: () => createWatchlist("My Watchlist", []),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: watchlistKeys.all }),
  });

  const updateMutation = useMutation({
    mutationFn: (tickers: string[]) => {
      if (!watchlist) throw new Error("No watchlist");
      return updateWatchlist(watchlist.id, { tickers });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: watchlistKeys.all }),
  });

  async function handleAddTicker(e: React.FormEvent) {
    e.preventDefault();
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) return;
    setAddError(null);

    // Ensure watchlist exists
    let wl = watchlist;
    if (!wl) {
      try {
        await ensureWatchlistMutation.mutateAsync();
        // After creation, refetch
        await queryClient.invalidateQueries({ queryKey: watchlistKeys.all });
        const lists = await fetchWatchlists();
        wl = lists[0];
        if (!wl) {
          setAddError("Failed to create watchlist.");
          return;
        }
      } catch {
        setAddError("Failed to create watchlist.");
        return;
      }
    }

    const current = wl.tickers ?? [];
    if (current.includes(ticker)) {
      setAddError(`${ticker} is already in the watchlist.`);
      return;
    }

    try {
      await updateMutation.mutateAsync([...current, ticker]);
      setNewTicker("");
    } catch {
      setAddError("Failed to add ticker.");
    }
  }

  async function handleRemoveTicker(ticker: string) {
    if (!watchlist) return;
    const current = watchlist.tickers ?? [];
    await updateMutation.mutateAsync(current.filter((t) => t !== ticker));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive p-2">
        Failed to load watchlist.
      </div>
    );
  }

  const tickers = watchlist?.tickers ?? [];

  return (
    <div className="flex flex-col gap-3 h-full" data-panel-id={panelId}>
      {/* Add ticker input */}
      <form onSubmit={handleAddTicker} className="flex gap-2">
        <Input
          placeholder="TICKER"
          value={newTicker}
          onChange={(e) => {
            setNewTicker(e.target.value.toUpperCase());
            setAddError(null);
          }}
          className="h-8 text-sm uppercase"
          maxLength={10}
          aria-label="Add ticker symbol"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0" aria-label="Add ticker">
          <Plus className="h-3 w-3" />
        </Button>
      </form>

      {addError && (
        <p className="text-xs text-destructive">{addError}</p>
      )}

      {/* Ticker list */}
      <div className="flex-1 overflow-auto space-y-1">
        {tickers.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Add tickers to your watchlist
          </p>
        )}
        {tickers.map((ticker) => (
          <div
            key={ticker}
            className={cn(
              "flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm transition-colors",
              activeTicker === ticker
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
            onClick={() => setActiveTicker(ticker)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setActiveTicker(ticker)}
            aria-label={`Select ${ticker}`}
            aria-pressed={activeTicker === ticker}
          >
            <span className="font-mono font-medium">{ticker}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void handleRemoveTicker(ticker);
              }}
              aria-label={`Remove ${ticker}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
