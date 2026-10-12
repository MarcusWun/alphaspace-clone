/**
 * FE-5Y-6: Unit tests for market.ts helpers — timeRangeToResolution and
 * bucketedWindowForTimeRange. Covers the 5Y baseline fix (PRD §5.1–5.2)
 * and regression guards for all other time ranges.
 */
import { describe, it, expect } from "vitest";
import {
  timeRangeToResolution,
  bucketedWindowForTimeRange,
  bucketedTo,
} from "@/lib/queries/market";

describe("timeRangeToResolution", () => {
  it('returns "D" for 5Y (fix: was "W")', () => {
    expect(timeRangeToResolution("5Y")).toBe("D");
  });

  it('returns "D" for 1Y (regression guard)', () => {
    expect(timeRangeToResolution("1Y")).toBe("D");
  });

  it('returns "D" for 3M (regression guard)', () => {
    expect(timeRangeToResolution("3M")).toBe("D");
  });

  it('returns "60" for 1W (regression guard)', () => {
    expect(timeRangeToResolution("1W")).toBe("60");
  });

  it('returns "60" for 1D', () => {
    expect(timeRangeToResolution("1D")).toBe("60");
  });

  it('returns "D" for 1M, 6M, YTD', () => {
    expect(timeRangeToResolution("1M")).toBe("D");
    expect(timeRangeToResolution("6M")).toBe("D");
    expect(timeRangeToResolution("YTD")).toBe("D");
  });
});

describe("bucketedWindowForTimeRange", () => {
  it("5Y window: from is exactly 5*365 days before to (PRD AC-8)", () => {
    const { from, to } = bucketedWindowForTimeRange("5Y");
    const diff = to - from;
    const fiveYearSeconds = 5 * 365 * 86_400;
    expect(diff).toBeGreaterThanOrEqual(fiveYearSeconds);
    expect(diff).toBeLessThanOrEqual(fiveYearSeconds + 2 * 86_400);
  });

  it("1Y window: from is >= 365 days and <= 370 days before to", () => {
    const { from, to } = bucketedWindowForTimeRange("1Y");
    const diff = to - from;
    expect(diff).toBeGreaterThanOrEqual(365 * 86_400);
    expect(diff).toBeLessThanOrEqual(370 * 86_400);
  });

  it("YTD window: from resolves to Jan 1 of current year (day-bucketed)", () => {
    const { from, to } = bucketedWindowForTimeRange("YTD");
    const jan1Unix =
      Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000 / 86_400) *
      86_400;
    expect(from).toBe(jan1Unix);
    expect(to).toBeGreaterThan(jan1Unix);
  });

  it("all ranges: returned `to` matches bucketedTo('D') (same-day stability)", () => {
    const expectedTo = bucketedTo("D");
    const ranges = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;
    for (const r of ranges) {
      expect(bucketedWindowForTimeRange(r).to).toBe(expectedTo);
    }
  });

  it("1M window: ~35 days", () => {
    const { from, to } = bucketedWindowForTimeRange("1M");
    expect(to - from).toBe(35 * 86_400);
  });

  it("3M window: ~100 days", () => {
    const { from, to } = bucketedWindowForTimeRange("3M");
    expect(to - from).toBe(100 * 86_400);
  });

  it("6M window: ~190 days", () => {
    const { from, to } = bucketedWindowForTimeRange("6M");
    expect(to - from).toBe(190 * 86_400);
  });

  it("from is always less than to", () => {
    const ranges = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;
    for (const r of ranges) {
      const { from, to } = bucketedWindowForTimeRange(r);
      expect(from).toBeLessThan(to);
    }
  });
});
