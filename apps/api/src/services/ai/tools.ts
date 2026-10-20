import { z } from "zod";
import { getQuote } from "../finnhub.js";
import { getCompanyNews } from "../news/index.js";
import { getCandles } from "../candles.js";
import {
  getStockMetric,
  getStockEarnings,
  getStockFilings,
  getStockRecommendation,
} from "../fundamentals.js";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const GetQuoteArgs = z.object({ symbol: z.string().min(1) });
const GetCandlesArgs = z.object({
  symbol: z.string().min(1),
  resolution: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});
const GetCompanyNewsArgs = z.object({
  symbol: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});
const GetFundamentalsMetricArgs = z.object({ symbol: z.string().min(1) });
const GetFundamentalsEarningsArgs = z.object({ symbol: z.string().min(1) });
const GetFundamentalsFilingsArgs = z.object({
  symbol: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});
const GetFundamentalsRecommendationArgs = z.object({ symbol: z.string().min(1) });

// Export schemas so tests and contracts can reference them
export const toolSchemas = {
  get_quote: GetQuoteArgs,
  get_candles: GetCandlesArgs,
  get_company_news: GetCompanyNewsArgs,
  get_fundamentals_metric: GetFundamentalsMetricArgs,
  get_fundamentals_earnings: GetFundamentalsEarningsArgs,
  get_fundamentals_filings: GetFundamentalsFilingsArgs,
  get_fundamentals_recommendation: GetFundamentalsRecommendationArgs,
} as const;

// ─── OpenAI tool schema (for Ollama) ─────────────────────────────────────────

export const openAiTools = [
  {
    type: "function",
    function: {
      name: "get_quote",
      description: "Current live stock price, day change, and bid/ask. Use for 'what's X trading at' or 'current price' questions.",
      parameters: {
        type: "object",
        required: ["symbol"],
        properties: { symbol: { type: "string", description: "Stock ticker symbol, e.g. NVDA" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_candles",
      description: "Historical OHLC price bars at the requested resolution. Use for charts or price history questions.",
      parameters: {
        type: "object",
        required: ["symbol", "resolution", "from", "to"],
        properties: {
          symbol: { type: "string" },
          resolution: { type: "string", description: "D, W, M, 1, 5, 15, 30, 60" },
          from: { type: "string", description: "Unix timestamp seconds (start)" },
          to: { type: "string", description: "Unix timestamp seconds (end)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_company_news",
      description: "Recent news headlines mentioning the ticker, often market-wide chatter. Use for general sentiment or recent coverage questions, not for authoritative earnings numbers.",
      parameters: {
        type: "object",
        required: ["symbol", "from", "to"],
        properties: {
          symbol: { type: "string" },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fundamentals_metric",
      description: "Core valuation and financial metrics (P/E, EV/EBITDA, margins, 52-week range). Use for valuation, growth, or balance-sheet questions.",
      parameters: {
        type: "object",
        required: ["symbol"],
        properties: { symbol: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fundamentals_earnings",
      description: "Quarterly EPS history: analyst estimate vs. actual, beat/miss for the last ~8 quarters. Use for ANY earnings-related question — results, beat/miss, estimate accuracy, 'latest earnings' prompts.",
      parameters: {
        type: "object",
        required: ["symbol"],
        properties: { symbol: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fundamentals_filings",
      description: "Recent SEC filings (10-K, 10-Q, 8-K) with filing dates and links. Use for regulatory or disclosure questions.",
      parameters: {
        type: "object",
        required: ["symbol"],
        properties: {
          symbol: { type: "string" },
          limit: { type: "number", description: "Max filings to return (1-50, default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fundamentals_recommendation",
      description: "Monthly analyst recommendation distribution (strongBuy / buy / hold / sell / strongSell counts). Use for 'what do analysts think' or sentiment questions.",
      parameters: {
        type: "object",
        required: ["symbol"],
        properties: { symbol: { type: "string" } },
      },
    },
  },
];

// ─── Anthropic tool schema ────────────────────────────────────────────────────

export const anthropicTools = openAiTools.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchTool(
  name: string,
  rawArgs: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    switch (name) {
      case "get_quote": {
        const parsed = GetQuoteArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const result = await getQuote(parsed.data.symbol);
        return { ok: true, result };
      }
      case "get_candles": {
        const parsed = GetCandlesArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const result = await getCandles(parsed.data);
        return { ok: true, result };
      }
      case "get_company_news": {
        const parsed = GetCompanyNewsArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const result = await getCompanyNews(parsed.data.symbol, parsed.data.from, parsed.data.to);
        return { ok: true, result };
      }
      case "get_fundamentals_metric": {
        const parsed = GetFundamentalsMetricArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const { data } = await getStockMetric(parsed.data.symbol);
        return { ok: true, result: data };
      }
      case "get_fundamentals_earnings": {
        const parsed = GetFundamentalsEarningsArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const { data } = await getStockEarnings(parsed.data.symbol);
        return { ok: true, result: data };
      }
      case "get_fundamentals_filings": {
        const parsed = GetFundamentalsFilingsArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const { data } = await getStockFilings(parsed.data.symbol, parsed.data.limit);
        return { ok: true, result: data };
      }
      case "get_fundamentals_recommendation": {
        const parsed = GetFundamentalsRecommendationArgs.safeParse(rawArgs);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const { data } = await getStockRecommendation(parsed.data.symbol);
        return { ok: true, result: data };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
