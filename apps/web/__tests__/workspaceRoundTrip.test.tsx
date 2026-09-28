/**
 * AS-FE-11: Workspace round-trip and layout restore tests.
 * - Save layout → reload → same panels + panel props
 * - Unknown panel ID in payload does not crash canvas
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkspaceLayout } from "@alpha/types";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockLayout: WorkspaceLayout = {
  panels: [
    { id: "panel-uuid-1", type: "watchlist", tickers: ["AAPL"] },
    { id: "panel-uuid-2", type: "news_feed" },
  ],
  grid: [
    { i: "panel-uuid-1", x: 0, y: 0, w: 3, h: 8 },
    { i: "panel-uuid-2", x: 3, y: 0, w: 4, h: 8 },
  ],
};

const onLayoutChange = vi.fn();

// Mock panel sub-components to avoid heavy deps
vi.mock("@/components/panels/WatchlistPanel", () => ({
  WatchlistPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`watchlist-${panelId}`}>Watchlist</div>
  ),
}));
vi.mock("@/components/panels/ComparisonChartPanel", () => ({
  ComparisonChartPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`chart-${panelId}`}>Chart</div>
  ),
}));
vi.mock("@/components/panels/NewsFeedPanel", () => ({
  NewsFeedPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`news-${panelId}`}>News</div>
  ),
}));
vi.mock("react-grid-layout", () => ({
  default: ({ children, onLayoutChange: onChange, layout }: {
    children: React.ReactNode;
    onLayoutChange: (l: unknown) => void;
    layout: unknown[];
  }) => (
    <div data-testid="grid-layout" onClick={() => onChange(layout)}>
      {children}
    </div>
  ),
  verticalCompactor: vi.fn(),
}));
vi.mock("react-grid-layout/css/styles.css", () => ({}));
vi.mock("react-resizable/css/styles.css", () => ({}));

import { CanvasShell } from "@/components/canvas/CanvasShell";
import { useTickerStore } from "@/lib/stores/tickerStore";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  onLayoutChange.mockClear();
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("CanvasShell", () => {
  it("renders panels from initialLayout", async () => {
    render(
      <CanvasShell
        workspaceId="ws-1"
        initialLayout={mockLayout}
        onLayoutChange={onLayoutChange}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId("watchlist-panel-uuid-1")).toBeInTheDocument();
      expect(screen.getByTestId("news-panel-uuid-2")).toBeInTheDocument();
    });
  });

  it("unknown panel ID in payload renders phase-placeholder, not crash", async () => {
    const layoutWithUnknown: WorkspaceLayout = {
      panels: [{ id: "ghost-id", type: "stock_chart" }],
      grid: [{ i: "ghost-id", x: 0, y: 0, w: 4, h: 8 }],
    };

    expect(() => {
      render(
        <CanvasShell
          workspaceId="ws-2"
          initialLayout={layoutWithUnknown}
          onLayoutChange={vi.fn()}
        />,
        { wrapper }
      );
    }).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText(/available in a future phase/i)).toBeInTheDocument();
    });
  });

  it("removing a panel calls onLayoutChange without the removed panel", async () => {
    render(
      <CanvasShell
        workspaceId="ws-3"
        initialLayout={mockLayout}
        onLayoutChange={onLayoutChange}
      />,
      { wrapper }
    );

    await waitFor(() =>
      expect(screen.getByTestId("watchlist-panel-uuid-1")).toBeInTheDocument()
    );

    vi.useFakeTimers();

    // Click the remove button for the watchlist panel
    const removeButtons = screen.getAllByLabelText(/remove/i);
    act(() => {
      fireEvent.click(removeButtons[0]!);
      vi.runAllTimers();
    });

    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({
        panels: expect.not.arrayContaining([
          expect.objectContaining({ id: "panel-uuid-1" }),
        ]),
      })
    );
    vi.useRealTimers();
  });
});
