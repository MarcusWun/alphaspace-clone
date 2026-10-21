/**
 * F8: CanvasShell — addPanel("article") auto-scrolls to the new panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkspaceLayout } from "@alpha/types";

// ── Panel mocks ───────────────────────────────────────────────────────────────
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
vi.mock("@/components/panels/StockChartPanel", () => ({
  StockChartPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`stock-${panelId}`}>StockChart</div>
  ),
}));
vi.mock("@/components/panels/FundamentalsPanel", () => ({
  FundamentalsPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`fund-${panelId}`}>Fundamentals</div>
  ),
}));
vi.mock("@/components/panels/AiAssistantPanel", () => ({
  AiAssistantPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`ai-${panelId}`}>AI</div>
  ),
}));
vi.mock("@/components/panels/ArticlePanel", () => ({
  ArticlePanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`article-panel-${panelId}`}>Article</div>
  ),
}));

// NewsFeedPanel mock uses the real useCanvas to trigger addPanel("article", ...)
vi.mock("@/components/panels/NewsFeedPanel", async () => {
  const { useCanvas } = await import("@/components/canvas/CanvasContext");
  return {
    NewsFeedPanel: ({ panelId }: { panelId: string }) => {
      const { addPanel } = useCanvas();
      return (
        <button
          data-testid={`spawn-article-${panelId}`}
          onClick={() =>
            addPanel("article", { url: "https://example.com", title: "T" })
          }
        >
          Open Article
        </button>
      );
    },
  };
});

vi.mock("react-grid-layout", () => ({
  default: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="grid-layout">{children}</div>,
  verticalCompactor: vi.fn(),
}));

import { CanvasShell } from "@/components/canvas/CanvasShell";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const initialLayout: WorkspaceLayout = {
  panels: [{ id: "news-1", type: "news_feed" }],
  grid: [{ i: "news-1", x: 0, y: 0, w: 4, h: 8 }],
};

describe("CanvasShell — article panel auto-scroll (F8)", () => {
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls scrollIntoView on new article panel after addPanel('article')", async () => {
    render(
      <CanvasShell
        workspaceId="ws-test"
        initialLayout={initialLayout}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    const button = screen.getByTestId("spawn-article-news-1");

    act(() => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    });
  });

  it("calls scrollIntoView exactly once per article panel spawn", async () => {
    render(
      <CanvasShell
        workspaceId="ws-test"
        initialLayout={initialLayout}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    const button = screen.getByTestId("spawn-article-news-1");

    act(() => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("scrolls to second article panel when a second news item is clicked", async () => {
    render(
      <CanvasShell
        workspaceId="ws-test"
        initialLayout={initialLayout}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    const button = screen.getByTestId("spawn-article-news-1");

    // First click
    act(() => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));

    // Second click
    act(() => {
      fireEvent.click(button);
    });
    await waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
    });
  });
});
