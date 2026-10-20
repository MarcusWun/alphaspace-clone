/**
 * FE-PY-6: CanvasShell — article excluded from toolbar; article panel can render.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/components/panels/NewsFeedPanel", () => ({
  NewsFeedPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`news-${panelId}`}>News</div>
  ),
}));
vi.mock("@/components/panels/StockChartPanel", () => ({
  StockChartPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`stock-chart-${panelId}`}>StockChart</div>
  ),
}));
vi.mock("@/components/panels/FundamentalsPanel", () => ({
  FundamentalsPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`fundamentals-${panelId}`}>Fundamentals</div>
  ),
}));
vi.mock("@/components/panels/AiAssistantPanel", () => ({
  AiAssistantPanel: ({ panelId }: { panelId: string }) => (
    <div data-testid={`ai-assistant-${panelId}`}>AI Assistant</div>
  ),
}));
vi.mock("@/components/panels/ArticlePanel", () => ({
  ArticlePanel: ({
    panelId,
    url,
  }: {
    panelId: string;
    url: string;
  }) => (
    <div data-testid={`article-${panelId}`} data-url={url}>
      Article
    </div>
  ),
}));
vi.mock("react-grid-layout", () => ({
  default: ({
    children,
    onLayoutChange: onChange,
    layout,
  }: {
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

describe("CanvasShell — article toolbar exclusion", () => {
  it("does NOT show an Article button in the toolbar", async () => {
    render(
      <CanvasShell
        workspaceId="ws-1"
        initialLayout={{ panels: [], grid: [] }}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    // The toolbar should not contain an "Article" button
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim() ?? "");
    expect(labels).not.toContain("Article");
    expect(labels).not.toContain("article");
  });

  it("renders an article panel when it is in the layout", async () => {
    const layoutWithArticle: WorkspaceLayout = {
      panels: [
        {
          id: "art-1",
          type: "article",
          url: "https://example.com/article",
          title: "Test Article",
        },
      ],
      grid: [{ i: "art-1", x: 0, y: 0, w: 6, h: 10 }],
    };

    useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });

    render(
      <CanvasShell
        workspaceId="ws-1"
        initialLayout={layoutWithArticle}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId("article-art-1")).toBeInTheDocument();
    });

    expect(screen.getByTestId("article-art-1")).toHaveAttribute(
      "data-url",
      "https://example.com/article"
    );
  });

  it("toolbar includes all standard panel types except article", async () => {
    render(
      <CanvasShell
        workspaceId="ws-1"
        initialLayout={{ panels: [], grid: [] }}
        onLayoutChange={vi.fn()}
      />,
      { wrapper }
    );

    // These panel types must appear in the toolbar
    const expectedLabels = [
      "Watchlist",
      "Group Comparison Chart",
      "News Feed",
      "Stock Chart",
      "Fundamentals",
      "AI Assistant",
    ];

    for (const label of expectedLabels) {
      expect(
        screen.getByRole("button", { name: new RegExp(label, "i") })
      ).toBeInTheDocument();
    }
  });
});
