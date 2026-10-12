import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { QuoteData } from "@alpha/types";

interface QuoteResponse {
  data: QuoteData;
}

export async function fetchQuote(symbol: string): Promise<QuoteData> {
  const res = await apiClient.get<QuoteResponse>(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  return res.data;
}

export function useQuote(symbol: string) {
  return useQuery({
    queryKey: ["quote", symbol],
    queryFn: () => fetchQuote(symbol),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
    refetchOnWindowFocus: false,
    enabled: !!symbol,
  });
}
