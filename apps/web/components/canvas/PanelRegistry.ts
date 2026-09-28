import type { ComponentType } from "react";
import type { PanelType } from "@alpha/types";

export interface PanelRegistryEntry {
  id: PanelType;
  label: string;
  /** Default grid dimensions */
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  /** Default panel props stored in WorkspaceLayout.panels[].* */
  defaultProps: Record<string, unknown>;
}

export const PANEL_REGISTRY: Record<PanelType, PanelRegistryEntry> = {
  watchlist: {
    id: "watchlist",
    label: "Watchlist",
    defaultW: 3,
    defaultH: 8,
    minW: 2,
    minH: 4,
    defaultProps: { tickers: [] },
  },
  comparison_chart: {
    id: "comparison_chart",
    label: "Group Comparison Chart",
    defaultW: 9,
    defaultH: 8,
    minW: 4,
    minH: 4,
    defaultProps: { tickers: ["AAPL", "MSFT", "NVDA"], timeRange: "1Y" },
  },
  stock_chart: {
    id: "stock_chart",
    label: "Stock Chart",
    defaultW: 9,
    defaultH: 8,
    minW: 4,
    minH: 4,
    defaultProps: {},
  },
  news_feed: {
    id: "news_feed",
    label: "News Feed",
    defaultW: 4,
    defaultH: 8,
    minW: 2,
    minH: 4,
    defaultProps: {},
  },
  fundamentals: {
    id: "fundamentals",
    label: "Fundamentals",
    defaultW: 6,
    defaultH: 8,
    minW: 3,
    minH: 4,
    defaultProps: {},
  },
  ai_assistant: {
    id: "ai_assistant",
    label: "AI Assistant",
    defaultW: 4,
    defaultH: 10,
    minW: 3,
    minH: 6,
    defaultProps: {},
  },
};

/**
 * Panel types available in Phase 1.
 * Phase 2+ panels are declared in the registry but not rendered yet.
 */
export const PHASE1_PANELS: PanelType[] = [
  "watchlist",
  "comparison_chart",
  "news_feed",
];

// Lazy component loader — panels import their own heavy deps
export type PanelComponent = ComponentType<{
  panelId: string;
  tickers?: string[];
  timeRange?: string;
  [key: string]: unknown;
}>;
