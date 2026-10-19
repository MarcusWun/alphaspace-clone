/**
 * FE-CR-3: PanelRegistry defaults — asserts ai_assistant bumped to 5w × 12h.
 * Also smoke-tests other registry entries for completeness.
 */
import { describe, it, expect } from "vitest";
import { PANEL_REGISTRY } from "@/components/canvas/PanelRegistry";

describe("PANEL_REGISTRY defaults", () => {
  it("ai_assistant defaultW is 5 (bumped from 4)", () => {
    expect(PANEL_REGISTRY.ai_assistant.defaultW).toBe(5);
  });

  it("ai_assistant defaultH is 12 (bumped from 10)", () => {
    expect(PANEL_REGISTRY.ai_assistant.defaultH).toBe(12);
  });

  it("ai_assistant minW and minH are unchanged (3 and 6)", () => {
    expect(PANEL_REGISTRY.ai_assistant.minW).toBe(3);
    expect(PANEL_REGISTRY.ai_assistant.minH).toBe(6);
  });

  it("watchlist minW/minH remain at 2/4 (no regression)", () => {
    expect(PANEL_REGISTRY.watchlist.minW).toBe(2);
    expect(PANEL_REGISTRY.watchlist.minH).toBe(4);
  });

  it("all entries have defaultW >= minW", () => {
    for (const [type, entry] of Object.entries(PANEL_REGISTRY)) {
      expect(entry.defaultW, `${type} defaultW < minW`).toBeGreaterThanOrEqual(entry.minW);
    }
  });

  it("all entries have defaultH >= minH", () => {
    for (const [type, entry] of Object.entries(PANEL_REGISTRY)) {
      expect(entry.defaultH, `${type} defaultH < minH`).toBeGreaterThanOrEqual(entry.minH);
    }
  });
});
