/**
 * FE-CR-3: Round-trip resize test — simulates onLayoutChange firing with a
 * resized item and asserts the new w/h reaches the onLayoutChange prop.
 * Uses vi.useFakeTimers() to drive the 300 ms debounce.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkspaceLayout } from "@alpha/types";
import React from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// The mock GridLayout fires onLayoutChange with the given newLayout when clicked.
// We store the onLayoutChange reference so tests can call it directly with a
// custom resized layout to simulate a real resize event.
const { mockLayoutChangeRef } = vi.hoisted(() => {
  const mockLayoutChangeRef: { current: ((l: unknown) => void) | null } = { current: null };
  return { mockLayoutChangeRef };
});

vi.mock("react-grid-layout", () => ({
  default: (props: {
    children: React.ReactNode;
    onLayoutChange?: (l: unknown) => void;
    layout?: unknown[];
    [key: string]: unknown;
  }) => {
    // Capture the callback so tests can call it with arbitrary layout
    mockLayoutChangeRef.current = props.onLayoutChange ?? null;
    return React.createElement(
      "div",
      { "data-testid": "grid-layout", onClick: () => props.onLayoutChange?.(props.layout) },
      props.children
    );
  },
  verticalCompactor: vi.fn(),
}));

import { CanvasShell } from "@/components/canvas/CanvasShell";

const baseLayout: WorkspaceLayout = {
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

afterEach(() => {
  vi.useRealTimers();
  mockLayoutChangeRef.current = null;
});

describe("CanvasShell resize round-trip", () => {
  it("resize event (new w/h) flows through onLayoutChange after debounce", async () => {
    vi.useFakeTimers();
    const onLayoutChange = vi.fn();

    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-rt-1",
        initialLayout: baseLayout,
        onLayoutChange,
      }),
      { wrapper }
    );

    // Simulate react-grid-layout firing onLayoutChange with a resized item:
    // p1 was 3×8, now resized to 3×14.
    const resizedLayout = [
      { i: "p1", x: 0, y: 0, w: 3, h: 14 },
      { i: "p2", x: 3, y: 0, w: 4, h: 8 },
    ];

    act(() => {
      expect(mockLayoutChangeRef.current).not.toBeNull();
      mockLayoutChangeRef.current!(resizedLayout);
      vi.advanceTimersByTime(400); // past the 300 ms debounce
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const payload = onLayoutChange.mock.calls[0]?.[0] as WorkspaceLayout;
    const p1Grid = payload.grid.find((g) => g.i === "p1");
    expect(p1Grid?.h).toBe(14);
    expect(p1Grid?.w).toBe(3);
  });

  it("resize without timer advance does NOT emit (debounce pending)", () => {
    vi.useFakeTimers();
    const onLayoutChange = vi.fn();

    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-rt-2",
        initialLayout: baseLayout,
        onLayoutChange,
      }),
      { wrapper }
    );

    const resizedLayout = [
      { i: "p1", x: 0, y: 0, w: 3, h: 16 },
      { i: "p2", x: 3, y: 0, w: 4, h: 8 },
    ];

    act(() => {
      mockLayoutChangeRef.current!(resizedLayout);
      // Do NOT advance timers
    });

    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("grid click (existing drag path) still fires onLayoutChange after debounce", async () => {
    vi.useFakeTimers();
    const onLayoutChange = vi.fn();

    render(
      React.createElement(CanvasShell, {
        workspaceId: "ws-rt-3",
        initialLayout: baseLayout,
        onLayoutChange,
      }),
      { wrapper }
    );

    act(() => {
      fireEvent.click(screen.getByTestId("grid-layout"));
      vi.advanceTimersByTime(400);
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });
});
