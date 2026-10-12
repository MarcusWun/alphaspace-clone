/**
 * Fundamentals proxy routes — Phase 2a
 *
 * Five GET endpoints under /stock/* — each is a thin pass-through to the
 * corresponding fundamentals service function. Auth + rate-limit plugins apply
 * globally (registered in app.ts before routes). No per-route plumbing needed.
 *
 * Error contract (PRD §5.6):
 *   Finnhub 429  → 429 { error: "rate_limited", statusCode: 429 }
 *   Finnhub 5xx  → 502 { error: "upstream_error", statusCode: 502 }
 *   Other errors → re-throw to Fastify global error handler → 500
 *
 * Observability logs (match candles.* naming from PR #7):
 *   fundamentals.cache_hit    info  { section, symbol }
 *   fundamentals.cache_miss   info  { section, symbol }
 *   fundamentals.upstream_call info  { section, symbol }
 *   fundamentals.rate_limited warn  { section, symbol }
 */

import { FastifyPluginAsync } from "fastify";
import { FinnhubError } from "../services/finnhub.js";
import {
  getStockMetric,
  getStockEarnings,
  getStockFinancials,
  getStockFilings,
  getStockRecommendation,
} from "../services/fundamentals.js";

const symbolOnlySchema = {
  querystring: {
    type: "object",
    required: ["symbol"],
    properties: {
      symbol: { type: "string", minLength: 1 },
    },
  },
};

type SymbolQuery = { symbol: string };
type FilingsQuery = { symbol: string; limit?: number };

export const fundamentalsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/stock/metric?symbol=X
  fastify.get<{ Querystring: SymbolQuery }>(
    "/stock/metric",
    { schema: symbolOnlySchema },
    async (request, reply) => {
      const { symbol } = request.query;
      try {
        const { data, source } = await getStockMetric(symbol);
        logCacheResult(request, "metric", symbol, source);
        return reply.send({ data });
      } catch (err) {
        return handleFinnhubError(err, "metric", symbol, request, reply);
      }
    }
  );

  // GET /api/stock/earnings?symbol=X
  fastify.get<{ Querystring: SymbolQuery }>(
    "/stock/earnings",
    { schema: symbolOnlySchema },
    async (request, reply) => {
      const { symbol } = request.query;
      try {
        const { data, source } = await getStockEarnings(symbol);
        logCacheResult(request, "earnings", symbol, source);
        return reply.send({ data });
      } catch (err) {
        return handleFinnhubError(err, "earnings", symbol, request, reply);
      }
    }
  );

  // GET /api/stock/financials?symbol=X
  fastify.get<{ Querystring: SymbolQuery }>(
    "/stock/financials",
    { schema: symbolOnlySchema },
    async (request, reply) => {
      const { symbol } = request.query;
      try {
        const { data, source } = await getStockFinancials(symbol);
        logCacheResult(request, "financials", symbol, source);
        return reply.send({ data });
      } catch (err) {
        return handleFinnhubError(err, "financials", symbol, request, reply);
      }
    }
  );

  // GET /api/stock/filings?symbol=X&limit=N  (limit optional, 1–50, default 10)
  fastify.get<{ Querystring: FilingsQuery }>(
    "/stock/filings",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const { symbol, limit = 10 } = request.query;
      try {
        const { data, source } = await getStockFilings(symbol, limit);
        logCacheResult(request, "filings", symbol, source);
        return reply.send({ data });
      } catch (err) {
        return handleFinnhubError(err, "filings", symbol, request, reply);
      }
    }
  );

  // GET /api/stock/recommendation?symbol=X
  fastify.get<{ Querystring: SymbolQuery }>(
    "/stock/recommendation",
    { schema: symbolOnlySchema },
    async (request, reply) => {
      const { symbol } = request.query;
      try {
        const { data, source } = await getStockRecommendation(symbol);
        logCacheResult(request, "recommendation", symbol, source);
        return reply.send({ data });
      } catch (err) {
        return handleFinnhubError(err, "recommendation", symbol, request, reply);
      }
    }
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function logCacheResult(
  request: { log: { info: (obj: object) => void } },
  section: string,
  symbol: string,
  source: "cache" | "upstream"
) {
  if (source === "cache") {
    request.log.info({ event: "fundamentals.cache_hit", section, symbol });
  } else {
    request.log.info({ event: "fundamentals.cache_miss", section, symbol });
    request.log.info({ event: "fundamentals.upstream_call", section, symbol });
  }
}

function handleFinnhubError(
  err: unknown,
  section: string,
  symbol: string,
  request: { log: { warn: (obj: object) => void } },
  reply: { code: (n: number) => { send: (body: object) => unknown } }
): unknown {
  if (err instanceof FinnhubError) {
    if (err.statusCode === 429) {
      request.log.warn({ event: "fundamentals.rate_limited", section, symbol });
      return reply.code(429).send({ error: "rate_limited", statusCode: 429 });
    }
    if (err.statusCode >= 500) {
      return reply.code(502).send({ error: "upstream_error", statusCode: 502 });
    }
  }
  throw err;
}
