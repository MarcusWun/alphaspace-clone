/**
 * Health check endpoint — no authentication required.
 *
 * GET /healthz
 *
 * Checks:
 *   - Postgres: SELECT 1
 *   - Redis: PING
 *   - Finnhub: cheap HEAD request, cached 60s
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@alpha/db";
import { getRedis } from "../services/redis.js";
import { checkFinnhubReachability } from "../services/finnhub.js";

export const healthzRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/healthz", { logLevel: "warn" }, async (_request, reply) => {
    const checks = await Promise.allSettled([
      checkPostgres(),
      checkRedis(),
      checkFinnhubReachability(),
    ]);

    const [postgres, redis, finnhub] = checks.map((r) =>
      r.status === "fulfilled" ? r.value : false
    );

    const healthy = Boolean(postgres && redis);
    const status = healthy ? 200 : 503;

    return reply.status(status).send({
      status: healthy ? "ok" : "degraded",
      checks: {
        postgres: postgres ? "ok" : "fail",
        redis: redis ? "ok" : "fail",
        finnhub: finnhub ? "ok" : "unavailable",
      },
      timestamp: new Date().toISOString(),
    });
  });
};

async function checkPostgres(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await getRedis().ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
