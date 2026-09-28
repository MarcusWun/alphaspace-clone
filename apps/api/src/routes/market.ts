/**
 * Market data proxy routes (Finnhub)
 *
 * FINNHUB_API_KEY is server-side only — it must never appear in any response.
 */

import { FastifyPluginAsync } from "fastify";
import {
  getCandles,
  getQuote,
  getCompanyNews,
  getFundamentals,
} from "../services/finnhub.js";

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
      const data = await getCandles(request.query);
      return reply.send({ data });
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
