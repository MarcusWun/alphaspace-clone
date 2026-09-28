/**
 * rateLimitPlugin
 *
 * Per-user Redis-backed rate limiting on /api/* routes.
 * Default: 120 requests/min per user. Tunable via env vars.
 * Returns 429 with Retry-After header when exceeded.
 */

import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { getRedis } from "../services/redis.js";

const rateLimitPluginImpl: FastifyPluginAsync = async (fastify) => {
  const max = parseInt(process.env["RATE_LIMIT_MAX"] ?? "120", 10);
  const timeWindow = parseInt(
    process.env["RATE_LIMIT_WINDOW_MS"] ?? "60000",
    10
  );

  await fastify.register(rateLimit, {
    max,
    timeWindow,
    // Key by user ID when available, fall back to IP
    keyGenerator(request) {
      return (request as { user?: { id?: string } }).user?.id ?? request.ip;
    },
    // Exempt the health check endpoint from rate limiting
    allowList(request) {
      return request.url === "/healthz";
    },
    redis: getRedis(),
    errorResponseBuilder(_request, context) {
      return {
        error: "Too many requests",
        retryAfter: Math.ceil(context.ttl / 1000),
        statusCode: 429,
      };
    },
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });
};

export const rateLimitPlugin = fp(rateLimitPluginImpl, { name: "rate-limit" });
