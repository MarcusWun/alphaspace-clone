import Fastify, { FastifyBaseLogger, FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { healthzRoute } from "./routes/healthz.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { watchlistRoutes } from "./routes/watchlists.js";
import { marketRoutes } from "./routes/market.js";
import { verifySessionPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rateLimit.js";

/** Pass a custom pino-compatible logger instance in tests to capture log entries. */
export async function buildApp(opts?: { loggerInstance?: FastifyBaseLogger }) {
  const app = Fastify(
    opts?.loggerInstance
      ? { loggerInstance: opts.loggerInstance }
      : {
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
        }
  );

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

  // Global error handler — PRD §3.3: must log err.stack, reqId, userId, route.
  // Must be registered BEFORE routes so that route contexts capture this handler at
  // registration time (Fastify bakes context.errorHandler when the route is added).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    // Use request.log so Fastify automatically includes reqId in the log entry
    request.log.error(
      {
        err: error,          // pino serialises .stack, .message, .type
        stack: error.stack,  // explicit field so log consumers can query it directly
        userId: request.user?.id,
        route: request.url,
      },
      "Request error"
    );
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
      code: error.code,
    });
  });

  // Protected routes
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(watchlistRoutes, { prefix: "/api" });
  await app.register(marketRoutes, { prefix: "/api" });

  return app;
}
