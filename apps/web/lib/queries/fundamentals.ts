import { apiClient } from "@/lib/api-client";

export const fundamentalsKeys = {
  metric: (symbol: string) => ["fundamentals.metric", symbol] as const,
  earnings: (symbol: string) => ["fundamentals.earnings", symbol] as const,
  financials: (symbol: string) => ["fundamentals.financials", symbol] as const,
  filings: (symbol: string) => ["fundamentals.filings", symbol] as const,
  recommendation: (symbol: string) => ["fundamentals.recommendation", symbol] as const,
};

export async function fetchStockMetric(symbol: string): Promise<unknown> {
  const res = await apiClient.get<{ data: unknown }>(`/api/stock/metric?symbol=${encodeURIComponent(symbol)}`);
  return res.data;
}

export async function fetchStockEarnings(symbol: string): Promise<unknown> {
  const res = await apiClient.get<{ data: unknown }>(`/api/stock/earnings?symbol=${encodeURIComponent(symbol)}`);
  return res.data;
}

export async function fetchStockFinancials(symbol: string): Promise<unknown> {
  const res = await apiClient.get<{ data: unknown }>(`/api/stock/financials?symbol=${encodeURIComponent(symbol)}`);
  return res.data;
}

export async function fetchStockFilings(symbol: string, limit = 10): Promise<unknown> {
  const res = await apiClient.get<{ data: unknown }>(`/api/stock/filings?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  return res.data;
}

export async function fetchStockRecommendation(symbol: string): Promise<unknown> {
  const res = await apiClient.get<{ data: unknown }>(`/api/stock/recommendation?symbol=${encodeURIComponent(symbol)}`);
  return res.data;
}
