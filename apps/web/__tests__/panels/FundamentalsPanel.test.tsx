/**
 * FE-P2A-7: FundamentalsPanel tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// Mock recharts to avoid canvas/SVG issues in jsdom
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

const MOCK_METRIC = {
  metric: {
    peTTM: 35.12,
    psTTM: 20.5,
    pbQuarterly: 8.2,
    enterpriseValueMultipleTTM: 45.3,
    "52WeekHigh": 502.66,
    "52WeekLow": 279.32,
    beta: 1.67,
    grossMarginTTM: 74.8,
    operatingMarginTTM: 62.4,
    netProfitMarginTTM: 55.1,
  },
  symbol: "NVDA",
};

const MOCK_EARNINGS = [
  { actual: 0.68, estimate: 0.64, period: "2026-07-27", symbol: "NVDA" },
  { actual: 0.61, estimate: 0.58, period: "2026-04-28", symbol: "NVDA" },
];

const MOCK_FINANCIALS = {
  data: [
    {
      year: 2026,
      quarter: 2,
      report: {
        ic: [
          { concept: "Revenues", value: 44_062_000_000, unit: "USD" },
          { concept: "OperatingIncomeLoss", value: 27_583_000_000, unit: "USD" },
          { concept: "NetIncomeLoss", value: 22_091_000_000, unit: "USD" },
          { concept: "EarningsPerShareBasic", value: 0.9, unit: "USD/shares" },
        ],
      },
    },
  ],
  symbol: "NVDA",
};

const MOCK_FILINGS = [
  { form: "10-K", filedDate: "2026-03-01", reportUrl: "https://sec.gov/1" },
  { form: "10-Q", filedDate: "2025-12-01", reportUrl: "https://sec.gov/2" },
];

const MOCK_RECOMMENDATION = [
  { period: "2026-10-01", strongBuy: 30, buy: 10, hold: 5, sell: 1, strongSell: 0 },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMetricMock.mockResolvedValue(MOCK_METRIC);
  fetchEarningsMock.mockResolvedValue(MOCK_EARNINGS);
  fetchFinancialsMock.mockResolvedValue(MOCK_FINANCIALS);
  fetchFilingsMock.mockResolvedValue(MOCK_FILINGS);
  fetchRecommendationMock.mockResolvedValue(MOCK_RECOMMENDATION);
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("FundamentalsPanel — happy path", () => {
  it("renders all 5 section headers for NVDA with no errors", async () => {
    render(<FundamentalsPanel panelId="fp-1" symbol="NVDA" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Valuation & Metrics")).toBeInTheDocument();
      expect(screen.getByText("Earnings")).toBeInTheDocument();
      expect(screen.getByText("Financials")).toBeInTheDocument();
      expect(screen.getByText("SEC Filings")).toBeInTheDocument();
      expect(screen.getByText("Analyst Recommendations")).toBeInTheDocument();
    });
  });

  it("renders section test ids for all 5 sections", async () => {
    render(<FundamentalsPanel panelId="fp-2" symbol="NVDA" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("fundamentals-section-metrics")).toBeInTheDocument();
      expect(screen.getByTestId("fundamentals-section-earnings")).toBeInTheDocument();
      expect(screen.getByTestId("fundamentals-section-financials")).toBeInTheDocument();
      expect(screen.getByTestId("fundamentals-section-filings")).toBeInTheDocument();
      expect(screen.getByTestId("fundamentals-section-recommendations")).toBeInTheDocument();
    });
  });
});

describe("FundamentalsPanel — empty / error state", () => {
  it("renders 'No data available' for all sections when fetchers return empty", async () => {
    fetchMetricMock.mockResolvedValue(null);
    fetchEarningsMock.mockResolvedValue([]);
    fetchFinancialsMock.mockResolvedValue({ data: [], symbol: "ZZZZ" });
    fetchFilingsMock.mockResolvedValue([]);
    fetchRecommendationMock.mockResolvedValue([]);

    render(<FundamentalsPanel panelId="fp-3" symbol="ZZZZ" />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const badges = screen.getAllByText("No data available");
      expect(badges.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("does not call toast on empty responses", async () => {
    const toastSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchMetricMock.mockResolvedValue(null);
    fetchEarningsMock.mockResolvedValue([]);
    fetchFinancialsMock.mockResolvedValue(null);
    fetchFilingsMock.mockResolvedValue([]);
    fetchRecommendationMock.mockResolvedValue([]);

    render(<FundamentalsPanel panelId="fp-4" symbol="ZZZZ" />, { wrapper: makeWrapper() });

    await waitFor(() => screen.getAllByText("No data available"));

    // No console.error calls from toast or unhandled errors
    expect(toastSpy).not.toHaveBeenCalled();
    toastSpy.mockRestore();
  });
});
