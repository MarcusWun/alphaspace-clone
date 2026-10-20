/**
 * FE-PY-2: useSavePanelConfig — debounce + unmount flush behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { updatePanelPropsMock } = vi.hoisted(() => ({
  updatePanelPropsMock: vi.fn(),
}));

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: updatePanelPropsMock,
    removePanel: vi.fn(),
  }),
}));

import { useSavePanelConfig } from "@/lib/hooks/useSavePanelConfig";

beforeEach(() => {
  updatePanelPropsMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSavePanelConfig", () => {
  it("does not call updatePanelProps before 500ms", () => {
    const { result } = renderHook(() => useSavePanelConfig("panel-1"));

    act(() => {
      result.current({ tickers: ["AAPL"] });
    });

    expect(updatePanelPropsMock).not.toHaveBeenCalled();
  });

  it("calls updatePanelProps after 500ms debounce", () => {
    const { result } = renderHook(() => useSavePanelConfig("panel-1"));

    act(() => {
      result.current({ tickers: ["AAPL"] });
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith("panel-1", {
      tickers: ["AAPL"],
    });
  });

  it("debounces rapid calls — only the last one fires", () => {
    const { result } = renderHook(() => useSavePanelConfig("panel-1"));

    act(() => {
      result.current({ tickers: ["AAPL"] });
      vi.advanceTimersByTime(100);
      result.current({ tickers: ["AAPL", "MSFT"] });
      vi.advanceTimersByTime(100);
      result.current({ tickers: ["AAPL", "MSFT", "NVDA"] });
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith("panel-1", {
      tickers: ["AAPL", "MSFT", "NVDA"],
    });
  });

  it("flushes latest props synchronously on unmount", () => {
    const { result, unmount } = renderHook(() => useSavePanelConfig("panel-1"));

    act(() => {
      result.current({ tickers: ["AAPL", "TSLA"] });
      // Do NOT advance timers — the debounce has NOT fired yet
    });

    expect(updatePanelPropsMock).not.toHaveBeenCalled();

    unmount();

    // Unmount flush must have fired synchronously
    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith("panel-1", {
      tickers: ["AAPL", "TSLA"],
    });
  });

  it("does not flush on unmount when save was never called", () => {
    const { unmount } = renderHook(() => useSavePanelConfig("panel-1"));
    unmount();
    expect(updatePanelPropsMock).not.toHaveBeenCalled();
  });

  it("passes merged props to updatePanelProps", () => {
    const { result } = renderHook(() => useSavePanelConfig("panel-2"));

    act(() => {
      result.current({ activeTicker: "AMD", timeRange: "3M" });
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledWith("panel-2", {
      activeTicker: "AMD",
      timeRange: "3M",
    });
  });
});
