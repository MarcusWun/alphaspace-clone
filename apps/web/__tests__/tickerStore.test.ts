/**
 * AS-FE-11: useTickerStore tests
 * Verifies set/subscribe pattern — multiple components see the same value.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { useTickerStore } from "@/lib/stores/tickerStore";

// Reset store between tests
beforeEach(() => {
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("useTickerStore", () => {
  it("initialises with null activeTicker and 1Y range", () => {
    const state = useTickerStore.getState();
    expect(state.activeTicker).toBeNull();
    expect(state.activeTimeRange).toBe("1Y");
  });

  it("setActiveTicker updates activeTicker", () => {
    act(() => useTickerStore.getState().setActiveTicker("AAPL"));
    expect(useTickerStore.getState().activeTicker).toBe("AAPL");
  });

  it("setActiveTimeRange updates activeTimeRange", () => {
    act(() => useTickerStore.getState().setActiveTimeRange("3M"));
    expect(useTickerStore.getState().activeTimeRange).toBe("3M");
  });

  it("multiple subscribers see the same activeTicker value", () => {
    const results: (string | null)[] = [];

    // Simulate two separate component subscriptions
    const unsub1 = useTickerStore.subscribe((s) => {
      results.push(s.activeTicker);
    });
    const unsub2 = useTickerStore.subscribe((s) => {
      results.push(s.activeTicker);
    });

    act(() => useTickerStore.getState().setActiveTicker("MSFT"));

    unsub1();
    unsub2();

    // Both subscribers fired with "MSFT"
    expect(results).toContain("MSFT");
    expect(results.filter((v) => v === "MSFT").length).toBeGreaterThanOrEqual(2);
  });

  it("setActiveTicker called twice updates to the last value", () => {
    act(() => {
      useTickerStore.getState().setActiveTicker("AAPL");
      useTickerStore.getState().setActiveTicker("NVDA");
    });
    expect(useTickerStore.getState().activeTicker).toBe("NVDA");
  });
});
