// ─── Panel types ──────────────────────────────────────────────────────────────

export type PanelType =
  | "watchlist"
  | "comparison_chart"
  | "stock_chart"
  | "news_feed"
  | "fundamentals"
  | "ai_assistant";

export interface PanelConfig {
  id: string; // UUID
  type: PanelType;
  title?: string;
  tickers?: string[];
  activeTicker?: string;
  timeRange?: TimeRange;
  [key: string]: unknown;
}

export interface LayoutItem {
  i: string; // panel UUID
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface WorkspaceLayout {
  panels: PanelConfig[];
  grid: LayoutItem[];
}

// ─── Time range ───────────────────────────────────────────────────────────────

export type TimeRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y" | "custom";

// ─── Market data ──────────────────────────────────────────────────────────────

export interface CandleData {
  c: number[]; // close
  h: number[]; // high
  l: number[]; // low
  o: number[]; // open
  s: string;   // status "ok" | "no_data"
  t: number[]; // timestamps (unix seconds)
  v: number[]; // volume
}

export interface QuoteData {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // previous close
  t: number;  // timestamp
}

export interface NewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FundamentalsData {
  metric: Record<string, number | string | null>;
  metricType: string;
  symbol: string;
}

// ─── API response envelope ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: string;
  code?: string;
  statusCode?: number;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

// ─── Workspace API types ──────────────────────────────────────────────────────

export interface CreateWorkspaceInput {
  name: string;
  layout?: WorkspaceLayout;
}

export interface UpdateWorkspaceInput {
  name?: string;
  layout?: WorkspaceLayout;
}

// ─── Watchlist API types ──────────────────────────────────────────────────────

export interface CreateWatchlistInput {
  name: string;
  tickers?: string[];
}

export interface UpdateWatchlistInput {
  name?: string;
  tickers?: string[];
}

// ─── Alert API types ──────────────────────────────────────────────────────────

export type AlertCondition = "above" | "below";
export type AlertStatus = "ACTIVE" | "TRIGGERED" | "CANCELLED";

export interface CreateAlertInput {
  ticker: string;
  condition: AlertCondition;
  target: number;
}

// ─── Finnhub WebSocket ────────────────────────────────────────────────────────

export interface FinnhubTrade {
  s: string;  // symbol
  p: number;  // price
  t: number;  // timestamp ms
  v: number;  // volume
  c?: string[]; // conditions
}

export interface FinnhubWsMessage {
  type: "trade" | "ping";
  data?: FinnhubTrade[];
}

// ─── Redis pub/sub ────────────────────────────────────────────────────────────

export const REDIS_CHANNELS = {
  tickerUpdate: (symbol: string) => `ticker:${symbol}:update`,
} as const;
