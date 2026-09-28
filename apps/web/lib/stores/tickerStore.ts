/**
 * Zustand store for cross-panel ticker linking.
 *
 * Subscription pattern:
 *   Use selectors to avoid full-store re-renders. Example:
 *
 *   // ✅ Subscribes only to activeTicker — re-renders only when it changes
 *   const activeTicker = useTickerStore((s) => s.activeTicker);
 *
 *   // ❌ Subscribes to the entire store — re-renders on every action
 *   const store = useTickerStore();
 *
 * Every panel that needs the active ticker or time range should import
 * this store and select only the fields it uses.
 */
import { create } from "zustand";
import type { TimeRange } from "@alpha/types";

interface TickerStore {
  activeTicker: string | null;
  activeTimeRange: TimeRange;
  setActiveTicker: (ticker: string) => void;
  setActiveTimeRange: (range: TimeRange) => void;
}

export const useTickerStore = create<TickerStore>((set) => ({
  activeTicker: null,
  activeTimeRange: "1Y",
  setActiveTicker: (ticker) => set({ activeTicker: ticker }),
  setActiveTimeRange: (range) => set({ activeTimeRange: range }),
}));
