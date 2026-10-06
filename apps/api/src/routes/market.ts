/**
 * Market data proxy routes.
 *
 * - Candles are served by Alpha Vantage (via services/candles.js) because
 *   Finnhub moved /stock/candle to a paid tier. The public contract
 *   (GET /api/candles → Finnhub-shaped {c,h,l,o,t,v,s}) is unchanged.
 * - Quote, news, and fundamentals stay on Finnhub (free tier still works).
 *
 * Secrets note: FINNHUB_API_KEY and ALPHA_VANTAGE_API_KEY are server-side
 * only — they must never appear in any response body.
 */

import { FastifyPluginAsync } from "fastify";
import {
  getQuote,
  getCompanyNews,
  getFundamentals,
} from "../services/finnhub.js";
import {
  getCandles,
  sliceCandles,
  UnknownSymbolError,
  QuotaExceededError,
  UnexpectedResponseError,
} from "../services/candles.js";

export const marketRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/candles?symbol=&resolution=&from=&to=
  fastify.get<{
    Querystring: {
      symbol: string;
      resolution: string;
      from: string;
      to: string;
    };
  }>(
    "/candles",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["symbol", "resolution", "from", "to"],
          properties: {
            symbol: { type: "string", minLength: 1 },
            resolution: { type: "string", enum: ["1", "5", "15", "30", "60", "D", "W", "M"] },
            from: { type: "string", pattern: "^[0-9]+$" },
            to: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (request, reply) => {
      const { symbol, resolution, from, to } = request.query;
      try {
        const full = await getCandles({ symbol, resolution, from, to });
        const sliced = sliceCandles(full, Number(from), Number(to));
        return reply.send({ data: sliced });
      } catch (err) {
        // Map service errors to the public HTTP contract (PRD §4.4).
        if (err instanceof UnknownSymbolError) {
          // Match Finnhub's "no data" sentinel so the frontend needs no
          // special-casing for unknown tickers.
          return reply.send({
            data: { s: "no_data", t: [], o: [], h: [], l: [], c: [], v: [] },
          });
        }
        if (err instanceof QuotaExceededError) {
          return reply
            .code(429)
            .send({ data: { s: "error", reason: "rate_limited" } });
        }
        if (err instanceof UnexpectedResponseError) {
          return reply
            .code(502)
            .send({ error: "Upstream chart provider returned an unexpected response" });
        }
        throw err;
      }
    }
  );

  // GET /api/quote?symbol=
  fastify.get<{ Querystring: { symbol: string } }>(
    "/quote",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const data = await getQuote(request.query.symbol);
      return reply.send({ data });
    }
  );

  // GET /api/company-news?symbol=&from=&to=
  fastify.get<{
    Querystring: { symbol: string; from: string; to: string };
  }>(
    "/company-news",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["symbol", "from", "to"],
          properties: {
            symbol: { type: "string", minLength: 1 },
            from: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            to: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
          },
        },
      },
    },
    async (request, reply) => {
      const { symbol, from, to } = request.query;
      const data = await getCompanyNews(symbol, from, to);
      return reply.send({ data });
    }
  );

  // GET /api/fundamentals?symbol=
  fastify.get<{ Querystring: { symbol: string } }>(
    "/fundamentals",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const data = await getFundamentals(request.query.symbol);
      return reply.send({ data });
    }
  );
};
