import type { NewsItem } from "@alpha/types";

export type { NewsItem };

export interface NewsProvider {
  name: "yahoo" | "finnhub";
  getCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
}
