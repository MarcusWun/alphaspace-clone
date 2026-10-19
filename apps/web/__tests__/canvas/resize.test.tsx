/**
 * FE-CR-3: Assert that GridLayout receives resizeConfig and every rglLayout
 * item has resizeHandles, per PRD §5.1/5.2 and RALPH task FE-CR-1.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkspaceLayout } from "@alpha/types";
import React from "react";

// ── Captured-props container (written by the mock below) ─────────────────────
// vi.hoisted ensures this runs before vi.mock hoisting resolves imports.
const { capturedGridLayoutProps } = vi.hoisted(() => {
  const capturedGridLayoutProps: { resizeConfig?: unknown; layout?: unknown[] } = {};
  return { capturedGridLayoutProps };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-grid-layout", () => ({
  default: (props: {
    children: React.ReactNode;
    resizeConfig?: unknown;
    layout?: unknown[];
    [key: string]: unknown;
  }) => {
    capturedGridLayoutProps.resizeConfig = props.resizeConfig;
    capturedGridLayoutProps.layout = props.layout as unknown[];
    return React.createElement("div", { "data-testid": "grid-layout" }, props.children);
  },
  verticalCompactor: vi.fn(),
}));

vi.mock("@/components/panels/WatchlistPanel", () => ({
  WatchlistPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `watchlist-${panelId}` }, "Watchlist"),
}));
vi.mock("@/components/panels/ComparisonChartPanel", () => ({
  ComparisonChartPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `chart-${panelId}` }, "Chart"),
}));
vi.mock("@/components/panels/NewsFeedPanel", () => ({
  NewsFeedPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `news-${panelId}` }, "News"),
}));
vi.mock("@/components/panels/StockChartPanel", () => ({
  StockChartPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `stock-${panelId}` }, "StockChart"),
}));
vi.mock("@/components/panels/FundamentalsPanel", () => ({
  FundamentalsPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `fundamentals-${panelId}` }, "Fundamentals"),
}));
vi.mock("@/components/panels/AiAssistantPanel", () => ({
  AiAssistantPanel: ({ panelId }: { panelId: string }) =>
    React.createElement("div", { "data-testid": `ai-${panelId}` }, "AI"),
}));
vi.mock("react-grid-layout/css/styles.css", () => ({}));

import { CanvasShell } from "@/components/canvas/CanvasShell";

const initialLayout: WorkspaceLayout = {
  panels: [
    { id: "p1", type: "watchlist", tickers: ["AAPL"] },
    { id: "p2", type: "news_feed" },
  ],
  grid: [
    { i: "p1", x: 0, y: 0, w: 3, h: 8 },
    { i: "p2", x: 3, y: 0, w: 4, h: 8 },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  capturedGridLayoutProps.resizeConfig = undefined;
  capturedGridLayoutProps.layout = undefined;
});

describe("CanvasShell resize config", () => {
  it("passes resizeConfig with enabled=true to GridLayout", () => {
    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-resize-1",
        initialLayout,
        onLayoutChange: vi.fn(),
      }),
      { wrapper }
    );

    expect(capturedGridLayoutProps.resizeConfig).toBeDefined();
    const rc = capturedGridLayoutProps.resizeConfig as { enabled: boolean; handles: string[] };
    expect(rc.enabled).toBe(true);
  });

  it("resizeConfig.handles includes 'se'", () => {
    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-resize-2",
        initialLayout,
        onLayoutChange: vi.fn(),
      }),
      { wrapper }
    );

    const rc = capturedGridLayoutProps.resizeConfig as { enabled: boolean; handles: string[] };
    expect(rc.handles).toContain("se");
  });

  it("every rglLayout item has resizeHandles containing 'se'", () => {
    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-resize-3",
        initialLayout,
        onLayoutChange: vi.fn(),
      }),
      { wrapper }
    );

    const layout = capturedGridLayoutProps.layout as Array<{ i: string; resizeHandles?: string[] }>;
    expect(layout).toBeDefined();
    expect(layout.length).toBeGreaterThan(0);
    for (const item of layout) {
      expect(item.resizeHandles).toBeDefined();
      expect(item.resizeHandles).toContain("se");
    }
  });

  it("drag and resize handles are not entangled (resizeConfig does not affect dragConfig)", () => {
    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-resize-4",
        initialLayout,
        onLayoutChange: vi.fn(),
      }),
      { wrapper }
    );

    // dragConfig.handle restricts drag to the title bar; resize config is separate
    const rc = capturedGridLayoutProps.resizeConfig as { enabled: boolean; handles: string[] };
    expect(rc.enabled).toBe(true);
    // The resize handles array should only contain resize axes, not CSS selectors
    for (const h of rc.handles) {
      expect(["se", "s", "e", "sw", "nw", "ne", "n", "w"]).toContain(h);
    }
  });

  it("legacy layout items (no resizeHandles in grid state) still get resizeHandles at render time", () => {
    const legacyLayout: WorkspaceLayout = {
      panels: [{ id: "legacy-1", type: "watchlist", tickers: [] }],
      // Intentionally no resizeHandles stored in grid — simulates pre-resize workspace
      grid: [{ i: "legacy-1", x: 0, y: 0, w: 3, h: 8 }],
    };

    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-legacy",
        initialLayout: legacyLayout,
        onLayoutChange: vi.fn(),
      }),
      { wrapper }
    );

    const layout = capturedGridLayoutProps.layout as Array<{ i: string; resizeHandles?: string[] }>;
    expect(layout).toBeDefined();
    expect(layout[0]?.resizeHandles).toContain("se");
  });
});
