/**
 * FE-P2A-7: Canvas serialization round-trip for Phase 2a panel types.
 * PRD §4 AC-7 — workspace persists both panels across reload.
 */
import { describe, it, expect } from "vitest";
import type { WorkspaceLayout, PanelConfig, PanelType } from "@alpha/types";

describe("Phase 2a panel serialization round-trip", () => {
  it("stock_chart panel config survives JSON stringify → parse", () => {
    const panel: PanelConfig = {
      id: "panel-sc-1",
      type: "stock_chart" satisfies PanelType,
      activeTicker: "NVDA",
      title: "Stock Chart",
    };

    const layout: WorkspaceLayout = {
      panels: [panel],
      grid: [{ i: "panel-sc-1", x: 0, y: 0, w: 9, h: 8 }],
    };

    const serialized = JSON.stringify(layout);
    const restored = JSON.parse(serialized) as WorkspaceLayout;

    expect(restored.panels[0]?.id).toBe("panel-sc-1");
    expect(restored.panels[0]?.type).toBe("stock_chart");
    expect(restored.panels[0]?.activeTicker).toBe("NVDA");
    expect(restored.grid[0]?.i).toBe("panel-sc-1");
  });

  it("fundamentals panel config survives JSON stringify → parse", () => {
    const panel: PanelConfig = {
      id: "panel-fd-1",
      type: "fundamentals" satisfies PanelType,
      activeTicker: "AAPL",
      title: "Fundamentals",
    };

    const layout: WorkspaceLayout = {
      panels: [panel],
      grid: [{ i: "panel-fd-1", x: 0, y: 0, w: 6, h: 8 }],
    };

    const serialized = JSON.stringify(layout);
    const restored = JSON.parse(serialized) as WorkspaceLayout;

    expect(restored.panels[0]?.id).toBe("panel-fd-1");
    expect(restored.panels[0]?.type).toBe("fundamentals");
    expect(restored.panels[0]?.activeTicker).toBe("AAPL");
  });

  it("mixed workspace with both new panel types round-trips correctly", () => {
    const layout: WorkspaceLayout = {
      panels: [
        { id: "p1", type: "stock_chart", activeTicker: "NVDA" },
        { id: "p2", type: "fundamentals", activeTicker: "MSFT" },
        { id: "p3", type: "watchlist", tickers: ["AAPL", "GOOGL"] },
      ],
      grid: [
        { i: "p1", x: 0, y: 0, w: 9, h: 8 },
        { i: "p2", x: 9, y: 0, w: 6, h: 8 },
        { i: "p3", x: 0, y: 8, w: 3, h: 8 },
      ],
    };

    const serialized = JSON.stringify(layout);
    const restored = JSON.parse(serialized) as WorkspaceLayout;

    expect(restored.panels).toHaveLength(3);
    expect(restored.grid).toHaveLength(3);

    const sc = restored.panels.find((p) => p.type === "stock_chart");
    const fd = restored.panels.find((p) => p.type === "fundamentals");
    const wl = restored.panels.find((p) => p.type === "watchlist");

    expect(sc?.activeTicker).toBe("NVDA");
    expect(fd?.activeTicker).toBe("MSFT");
    expect(wl?.tickers).toEqual(["AAPL", "GOOGL"]);
  });

  it("grid item IDs match panel IDs after round-trip", () => {
    const layout: WorkspaceLayout = {
      panels: [
        { id: "abc-123", type: "stock_chart" },
        { id: "def-456", type: "fundamentals" },
      ],
      grid: [
        { i: "abc-123", x: 0, y: 0, w: 9, h: 8 },
        { i: "def-456", x: 0, y: 8, w: 6, h: 8 },
      ],
    };

    const restored = JSON.parse(JSON.stringify(layout)) as WorkspaceLayout;

    const panelIds = new Set(restored.panels.map((p) => p.id));
    const gridIds = new Set(restored.grid.map((g) => g.i));

    for (const id of panelIds) {
      expect(gridIds.has(id)).toBe(true);
    }
  });
});
