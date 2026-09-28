/**
 * verifySessionPlugin
 *
 * Validates the request against Auth.js session cookie (from Postgres sessions table)
 * OR a Bearer JWT signed with AUTH_SECRET for programmatic access.
 *
 * Sets req.user = { id, email } on success.
 * Returns 401 on failure.
 */

import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { prisma } from "@alpha/db";

export interface RequestUser {
  id: string;
  email: string;
}

// Augment Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    user: RequestUser;
  }
}

const verifySessionPluginImpl: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Public endpoints skip authentication
    if (request.url === "/healthz") return;

    const secret = process.env["AUTH_SECRET"];
    if (!secret) {
      reply.status(500).send({ error: "AUTH_SECRET not configured" });
      return;
    }

    // 1) Try Bearer JWT (programmatic access)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, secret) as {
          sub?: string;
          email?: string;
        };
        if (!payload.sub || !payload.email) throw new Error("Invalid payload");
        request.user = { id: payload.sub, email: payload.email };
        return;
      } catch {
        reply.status(401).send({ error: "Invalid or expired token" });
        return;
      }
    }

    // 2) Try Auth.js session cookie
    const cookies = parseCookies(request.headers.cookie ?? "");
    const sessionToken =
      cookies["__Secure-authjs.session-token"] ??
      cookies["authjs.session-token"];

    if (!sessionToken) {
      reply.status(401).send({ error: "Unauthenticated" });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { sessionToken },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!session || session.expires < new Date()) {
      reply.status(401).send({ error: "Session expired or not found" });
      return;
    }

    request.user = { id: session.user.id, email: session.user.email };
  });
};

export const verifySessionPlugin = fp(verifySessionPluginImpl, {
  name: "verify-session",
});

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
    result[key] = val;
  }
  return result;
}
