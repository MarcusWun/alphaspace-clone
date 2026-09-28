import Fastify, { FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { healthzRoute } from "./routes/healthz.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { watchlistRoutes } from "./routes/watchlists.js";
import { marketRoutes } from "./routes/market.js";
import { verifySessionPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rateLimit.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            // Never log auth headers
            hostname: request.hostname,
          };
        },
      },
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.token",
        "*.key",
        "*.secret",
        "*.password",
      ],
    },
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // managed by Nginx in prod
  });

  // CORS
  await app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000",
    credentials: true,
  });

  // Health check — public, no auth required
  await app.register(healthzRoute);

  // Rate limiting (fp — applies globally; /healthz skipped via skip() option)
  await app.register(rateLimitPlugin);

  // Session verification (fp — applies globally; /healthz skipped via URL check)
  await app.register(verifySessionPlugin);

  // Protected routes
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(watchlistRoutes, { prefix: "/api" });
  await app.register(marketRoutes, { prefix: "/api" });

  // Global error handler
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({ err: error }, "Request error");
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
      code: error.code,
    });
  });

  return app;
}
