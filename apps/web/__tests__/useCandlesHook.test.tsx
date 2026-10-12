/**
 * FE-RL-6: useCandles hook + ComparisonChartPanel rate-limit tests.
 *
 * Covers:
 *  1. Single-flight invariant — 10 concurrent mounts → exactly 1 fetch
 *  2. Bucket boundary stability — +1s → same key; +24h → different key (D resolution)
 *  3. rate_limited no-retry — rateLimited:true resolves → no retry, exactly 1 call
 *  4. Banner render — rateLimited:true shows banner text, no Retry button
 *  5. Banner absent when not rate-limited
 *  6. Chart-type toggle stability — toggling line↔candles does NOT change queryKey
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// ── Hoisted mock fns ─────────────────────────────────────────────────────────
const { fetchWithMetaMock, MOCK_DATA } = vi.hoisted(() => {
  const mockData = {
    s: "ok",
    c: [100, 110, 105],
    t: [1700000000, 1700086400, 1700172800],
    h: [112, 115, 108],
    l: [98, 108, 102],
    o: [100, 110, 104],
    v: [500_000, 600_000, 550_000],
  };
  return {
    MOCK_DATA: mockData,
    fetchWithMetaMock: vi.fn().mockResolvedValue({ data: mockData, rateLimited: false }),
  };
});

vi.mock("@/lib/queries/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/market")>();
  return {
    ...actual,
    fetchCandles: fetchWithMetaMock,
    fetchCandlesWithMeta: fetchWithMetaMock,
  };
});

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    removeSeries: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  })),
  ColorType: { Solid: "solid" },
  LineSeries: { _type: "line" },
  CandlestickSeries: { _type: "candle" },
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
}));

import { useCandles } from "@/lib/queries/useCandles";
import { ComparisonChartPanel } from "@/components/panels/ComparisonChartPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQC(opts?: ConstructorParameters<typeof QueryClient>[0]) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    ...opts,
  });
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  fetchWithMetaMock.mockClear();
  fetchWithMetaMock.mockResolvedValue({ data: MOCK_DATA, rateLimited: false });
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Single-flight invariant ────────────────────────────────────────────────
describe("useCandles — single-flight invariant", () => {
  it("10 concurrent useCandles('AAPL', 'D') in one QueryClient → exactly 1 fetch", async () => {
    const qc = makeQC();

    function TenHooks() {
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      useCandles("AAPL", "D");
      return <span data-testid="done">ok</span>;
    }

    render(<TenHooks />, { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(fetchWithMetaMock).toHaveBeenCalled());
    // Allow settle
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchWithMetaMock).toHaveBeenCalledTimes(1);
  });

  it("two useCandles components sharing a QueryClient → exactly 1 fetch", async () => {
    const qc = makeQC();

    const { result: r1 } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc),
    });
    const { result: r2 } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(r1.current.isLoading).toBe(false);
      expect(r2.current.isLoading).toBe(false);
    });

    expect(fetchWithMetaMock).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Bucket boundary stability ──────────────────────────────────────────────
describe("useCandles — bucket boundary stability (D resolution)", () => {
  it("queryKey[3] and [4] are stable after +1 second (within same bucket window)", async () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-01-15T12:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    const qc1 = makeQC();
    const { unmount } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc1),
    });

    const key1 = qc1.getQueryCache().getAll()[0]?.queryKey;
    const from1 = key1?.[3];
    const to1 = key1?.[4];

    unmount();

    // Advance 1 second — still within the same UTC-midnight bucket
    vi.advanceTimersByTime(1000);

    const qc2 = makeQC();
    renderHook(() => useCandles("AAPL", "D"), { wrapper: makeWrapper(qc2) });

    const key2 = qc2.getQueryCache().getAll()[0]?.queryKey;
    expect(key2?.[3]).toBe(from1);
    expect(key2?.[4]).toBe(to1);
  });

  it("queryKey[4] advances after crossing UTC midnight (+25h)", async () => {
    vi.useFakeTimers();
    const day1 = new Date("2026-01-15T12:00:00Z").getTime();
    vi.setSystemTime(day1);

    const qc1 = makeQC();
    const { unmount } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc1),
    });
    const to1 = qc1.getQueryCache().getAll()[0]?.queryKey[4] as number;
    unmount();

    // Advance 25 hours — crosses into next UTC-midnight bucket
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    const qc2 = makeQC();
    renderHook(() => useCandles("AAPL", "D"), { wrapper: makeWrapper(qc2) });
    const to2 = qc2.getQueryCache().getAll()[0]?.queryKey[4] as number;

    expect(to2).not.toBe(to1);
    expect(to2).toBeGreaterThan(to1);
  });
});

// ── 3. rate_limited no-retry ──────────────────────────────────────────────────
describe("useCandles — rate_limited: no retry fires", () => {
  it("resolves with rateLimited:true → exactly 1 fetch, no retry", async () => {
    fetchWithMetaMock.mockResolvedValue({ data: { s: "no_data" as const, c: [], h: [], l: [], o: [], t: [], v: [] }, rateLimited: true });

    const qc = makeQC();
    const { result } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Allow plenty of time for any spurious retry
    await new Promise((r) => setTimeout(r, 200));

    expect(fetchWithMetaMock).toHaveBeenCalledTimes(1);
    expect(result.current.rateLimited).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it("error with rateLimited:true on the thrown error → 0 retries (1 total call)", async () => {
    const rateLimitedError = Object.assign(new Error("rate limited"), { rateLimited: true });
    fetchWithMetaMock.mockRejectedValue(rateLimitedError);

    // Use a client that would normally allow retries
    const qc = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const { result } = renderHook(() => useCandles("AAPL", "D"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await new Promise((r) => setTimeout(r, 200));

    // retry predicate returns false for rateLimited errors → exactly 1 call
    expect(fetchWithMetaMock).toHaveBeenCalledTimes(1);
  });
});

// ── 4 & 5. rate_limited banner render ─────────────────────────────────────────
describe("ComparisonChartPanel — rate-limited banner", () => {
  it("shows banner when any query returns rateLimited:true", async () => {
    fetchWithMetaMock.mockResolvedValue({
      data: { s: "no_data" as const, c: [], h: [], l: [], o: [], t: [], v: [] },
      rateLimited: true,
    });

    const qc = makeQC();
    render(
      <ComparisonChartPanel panelId="p1" tickers={["AAPL"]} timeRange="1Y" />,
      { wrapper: makeWrapper(qc) }
    );

    await waitFor(() =>
      expect(screen.getByTestId("rate-limited-banner")).toBeInTheDocument()
    );
    expect(screen.getByTestId("rate-limited-banner")).toHaveTextContent(
      "Chart data temporarily unavailable (rate-limited). Try again in a few minutes."
    );
    // No Retry button — banner is non-interactive
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("does NOT show banner when rateLimited:false (normal response)", async () => {
    const qc = makeQC();
    render(
      <ComparisonChartPanel panelId="p2" tickers={["AAPL"]} timeRange="1Y" />,
      { wrapper: makeWrapper(qc) }
    );

    await waitFor(() => expect(fetchWithMetaMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByTestId("rate-limited-banner")).toBeNull();
  });
});

// ── 6. Chart-type toggle stability ────────────────────────────────────────────
describe("ComparisonChartPanel — chart-type toggle does not change queryKey", () => {
  it("toggling from line to candles preserves the query cache key", async () => {
    const qc = makeQC();

    const { rerender } = render(
      <ComparisonChartPanel panelId="p3" tickers={["AAPL"]} timeRange="1Y" chartType="line" />,
      { wrapper: makeWrapper(qc) }
    );

    await waitFor(() => expect(fetchWithMetaMock).toHaveBeenCalled());

    const callsBefore = fetchWithMetaMock.mock.calls.length;
    const keysBefore = qc.getQueryCache().getAll().map((q) => q.queryKey);

    // Toggle to candles
    act(() => {
      rerender(
        <ComparisonChartPanel panelId="p3" tickers={["AAPL"]} timeRange="1Y" chartType="candles" />
      );
    });

    await new Promise((r) => setTimeout(r, 100));

    const keysAfter = qc.getQueryCache().getAll().map((q) => q.queryKey);
    // queryKey must be identical
    expect(keysAfter).toEqual(keysBefore);
    // No new fetches triggered by the toggle
    expect(fetchWithMetaMock).toHaveBeenCalledTimes(callsBefore);
  });
});
