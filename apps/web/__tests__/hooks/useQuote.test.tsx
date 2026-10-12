/**
 * FE-P2A-2: useQuote hook tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: apiGetMock },
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(msg: string, code: number) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

import { useQuote } from "@/lib/queries/useQuote";

const MOCK_QUOTE = {
  c: 135.72,
  d: 2.45,
  dp: 1.84,
  h: 136.5,
  l: 133.1,
  o: 133.5,
  pc: 133.27,
  t: 1728000000,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  apiGetMock.mockClear();
  apiGetMock.mockResolvedValue({ data: MOCK_QUOTE });
});

describe("useQuote", () => {
  it("resolves to the mocked payload for NVDA", async () => {
    const { result } = renderHook(() => useQuote("NVDA"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_QUOTE);
    expect(apiGetMock).toHaveBeenCalledWith(
      expect.stringContaining("symbol=NVDA")
    );
  });

  it("is disabled when symbol is empty string", () => {
    const { result } = renderHook(() => useQuote(""), { wrapper: makeWrapper() });
    expect(result.current.isPending).toBe(true);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("query options include refetchInterval 15000", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useQuote("NVDA"), { wrapper });

    await waitFor(() => {
      const query = qc.getQueryCache().find({ queryKey: ["quote", "NVDA"] });
      expect(query).toBeDefined();
    });

    const query = qc.getQueryCache().find({ queryKey: ["quote", "NVDA"] });
    const options = query?.options as { refetchInterval?: number };
    expect(options?.refetchInterval).toBe(15_000);
  });
});
