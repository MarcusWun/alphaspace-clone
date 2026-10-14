import { describe, it, expect } from "vitest";
import { openAiTools } from "../../services/ai/tools.js";

describe("openAiTools descriptions (PRD §3 routing contract)", () => {
  it("has exactly 7 tools", () => {
    expect(openAiTools).toHaveLength(7);
  });

  it("get_quote description contains 'price'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_quote")!.function.description;
    expect(desc.toLowerCase()).toContain("price");
  });

  it("get_candles description contains 'ohlc' or 'historical'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_candles")!.function.description;
    const lower = desc.toLowerCase();
    expect(lower.includes("ohlc") || lower.includes("historical")).toBe(true);
  });

  it("get_company_news description contains 'news' and 'not for authoritative earnings'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_company_news")!.function.description;
    const lower = desc.toLowerCase();
    expect(lower).toContain("news");
    expect(lower).toContain("not for authoritative earnings");
  });

  it("get_fundamentals_metric description contains 'valuation' or 'p/e'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_fundamentals_metric")!.function.description;
    const lower = desc.toLowerCase();
    expect(lower.includes("valuation") || lower.includes("p/e")).toBe(true);
  });

  it("get_fundamentals_earnings description contains 'earnings' and 'beat/miss'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_fundamentals_earnings")!.function.description;
    const lower = desc.toLowerCase();
    expect(lower).toContain("earnings");
    expect(lower).toContain("beat/miss");
  });

  it("get_fundamentals_filings description contains 'filings' or 'sec'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_fundamentals_filings")!.function.description;
    const lower = desc.toLowerCase();
    expect(lower.includes("filings") || lower.includes("sec")).toBe(true);
  });

  it("get_fundamentals_recommendation description contains 'analyst'", () => {
    const desc = openAiTools.find((t) => t.function.name === "get_fundamentals_recommendation")!.function.description;
    expect(desc.toLowerCase()).toContain("analyst");
  });
});
