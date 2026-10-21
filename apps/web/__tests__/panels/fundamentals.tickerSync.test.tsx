/**
 * F6: FundamentalsPanel cross-panel ticker sync
 * F7 (shared): Cold-load regression — activeTicker null falls through to symbolProp
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { fetchMetricMock, fetchEarningsMock, fetchFinancialsMock, fetchFilingsMock, fetchRecommendationMock } =
  vi.hoisted(() => ({
    fetchMetricMock: vi.fn(),
    fetchEarningsMock: vi.fn(),
    fetchFinancialsMock: vi.fn(),
    fetchFilingsMock: vi.fn(),
    fetchRecommendationMock: vi.fn(),
  }));

vi.mock("@/lib/queries/fundamentals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/fundamentals")>();
  return {
    ...actual,
    fetchStockMetric: fetchMetricMock,
    fetchStockEarnings: fetchEarningsMock,
    fetchStockFinancials: fetchFinancialsMock,
    fetchStockFilings: fetchFilingsMock,
    fetchStockRecommendation: fetchRecommendationMock,
  };
});

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: vi.fn(),
    removePanel: vi.fn(),
  }),
  CanvasProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { FundamentalsPanel } from "@/components/panels/FundamentalsPanel";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMetricMock.mockResolvedValue(null);
  fetchEarningsMock.mockResolvedValue([]);
  fetchFinancialsMock.mockResolvedValue({ data: [], symbol: "TEST" });
  fetchFilingsMock.mockResolvedValue([]);
  fetchRecommendationMock.mockResolvedValue([]);
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("FundamentalsPanel — ticker sync (F6)", () => {
  it("activeTicker wins over symbolProp when both are set", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<FundamentalsPanel panelId="fp-sync-1" symbol="AVGO" />, { wrapper: makeWrapper() });

    // The panel header renders effectiveSymbol (uppercase by CSS, but text content is AAPL)
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    expect(screen.queryByText("AVGO")).not.toBeInTheDocument();
  });

  it("updates displayed symbol when activeTicker changes", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<FundamentalsPanel panelId="fp-sync-2" symbol="AVGO" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    act(() => {
      useTickerStore.setState({ activeTicker: "GOOGL", activeTimeRange: "1Y" });
    });

    await waitFor(() => expect(screen.getByText("GOOGL")).toBeInTheDocument());
  });

  it("all 5 sections are rendered with the activeTicker symbol", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<FundamentalsPanel panelId="fp-sync-3" symbol="AVGO" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    // All 5 sections must be present (PRD §4.2)
    expect(screen.getByTestId("fundamentals-section-metrics")).toBeInTheDocument();
    expect(screen.getByTestId("fundamentals-section-earnings")).toBeInTheDocument();
    expect(screen.getByTestId("fundamentals-section-financials")).toBeInTheDocument();
    expect(screen.getByTestId("fundamentals-section-filings")).toBeInTheDocument();
    expect(screen.getByTestId("fundamentals-section-recommendations")).toBeInTheDocument();
  });
});

describe("FundamentalsPanel — cold-load regression (F7)", () => {
  it("falls through to symbolProp when activeTicker is null", async () => {
    useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });

    render(<FundamentalsPanel panelId="fp-cold" symbol="MSFT" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("MSFT")).toBeInTheDocument());
  });
});
