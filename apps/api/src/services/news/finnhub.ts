import { finnhubFetch } from "../finnhub.js";
import type { NewsItem } from "@alpha/types";
import type { NewsProvider } from "./types.js";

interface FinnhubNewsRaw {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsItem[]> {
  const raw = (await finnhubFetch("/company-news", { symbol, from, to })) as FinnhubNewsRaw[];
  if (!Array.isArray(raw)) return [];

  return raw.map((item): NewsItem => ({
    category: item.category ?? "company",
    datetime: item.datetime ?? 0,
    headline: item.headline ?? "",
    id: item.id ?? 0,
    image: item.image ?? "",
    related: item.related ?? symbol,
    source: item.source ?? "",
    summary: item.summary ?? "",
    url: item.url ?? "",
  }));
}

export const finnhubProvider: NewsProvider = {
  name: "finnhub",
  getCompanyNews,
};
