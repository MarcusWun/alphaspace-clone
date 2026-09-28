import { apiClient } from "@/lib/api-client";

export interface Watchlist {
  id: string;
  name: string;
  tickers: string[];
  updatedAt: string;
  createdAt: string;
}

export interface WatchlistListResponse {
  data: Watchlist[];
}

export interface WatchlistSingleResponse {
  data: Watchlist;
}

export const watchlistKeys = {
  all: ["watchlists"] as const,
  single: (id: string) => ["watchlists", id] as const,
};

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const res = await apiClient.get<WatchlistListResponse>("/api/watchlists");
  return res.data;
}

export async function fetchWatchlist(id: string): Promise<Watchlist> {
  const res = await apiClient.get<WatchlistSingleResponse>(`/api/watchlists/${id}`);
  return res.data;
}

export async function createWatchlist(name: string, tickers?: string[]): Promise<Watchlist> {
  const res = await apiClient.post<WatchlistSingleResponse>("/api/watchlists", { name, tickers });
  return res.data;
}

export async function updateWatchlist(
  id: string,
  updates: { name?: string; tickers?: string[] }
): Promise<Watchlist> {
  const res = await apiClient.put<WatchlistSingleResponse>(`/api/watchlists/${id}`, updates);
  return res.data;
}

export async function deleteWatchlist(id: string): Promise<void> {
  await apiClient.delete(`/api/watchlists/${id}`);
}
