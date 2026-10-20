/**
 * FE-PY-4: FundamentalsPanel persistence — symbol changes trigger save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { updatePanelPropsMock, tickerStoreMock } = vi.hoisted(() => ({
  updatePanelPropsMock: vi.fn(),
  // We'll swap activeTicker between renders
  tickerStoreMock: vi.fn(),
}));

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: updatePanelPropsMock,
    removePanel: vi.fn(),
  }),
}));

vi.mock("@/lib/stores/tickerStore", () => ({
  useTickerStore: tickerStoreMock,
}));

// Mock all child components to avoid heavy deps
vi.mock("@/components/panels/FundamentalsMetrics", () => ({
  FundamentalsMetrics: ({ symbol }: { symbol: string }) => (
    <div data-testid="metrics">{symbol}</div>
  ),
}));
vi.mock("@/components/panels/FundamentalsEarnings", () => ({
  FundamentalsEarnings: () => <div>Earnings</div>,
}));
vi.mock("@/components/panels/FundamentalsFinancials", () => ({
  FundamentalsFinancials: () => <div>Financials</div>,
}));
vi.mock("@/components/panels/FundamentalsFilings", () => ({
  FundamentalsFilings: () => <div>Filings</div>,
}));
vi.mock("@/components/panels/FundamentalsRecommendations", () => ({
  FundamentalsRecommendations: () => <div>Recommendations</div>,
}));

import { FundamentalsPanel } from "@/components/panels/FundamentalsPanel";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  updatePanelPropsMock.mockClear();
  tickerStoreMock.mockImplementation(
    (selector: (s: { activeTicker: string | null }) => unknown) =>
      selector({ activeTicker: "NVDA" })
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FundamentalsPanel persistence", () => {
  it("does NOT call save on initial mount", () => {
    render(
      <FundamentalsPanel panelId="fund-1" symbol="NVDA" />,
      { wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(updatePanelPropsMock).not.toHaveBeenCalled();
  });

  it("saves activeTicker when effectiveSymbol changes", () => {
    // Reuse the same QueryClient so React does an in-place update (not remount)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <FundamentalsPanel panelId="fund-1" symbol="NVDA" />
      </QueryClientProvider>
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(updatePanelPropsMock).not.toHaveBeenCalled();

    // Re-render with a new symbol (same QC so no remount) — flush effects first
    rerender(
      <QueryClientProvider client={qc}>
        <FundamentalsPanel panelId="fund-1" symbol="AMD" />
      </QueryClientProvider>
    );
    // Now advance timers to fire the debounce
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith("fund-1", {
      activeTicker: "AMD",
    });
  });
});
