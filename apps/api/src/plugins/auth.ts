/**
 * verifySessionPlugin
 *
 * Validates the request against Auth.js session cookie (JWE decoded in-process)
 * OR a Bearer JWT signed with AUTH_SECRET for programmatic access.
 *
 * Cookie branch: Auth.js v5 with session: { strategy: "jwt" } writes the session
 * as a JWE (encrypted JWT) in a cookie — NOT as a Postgres session row. The
 * previous prisma.session.findUnique() lookup returned null for every request
 * because no session rows are written under JWT strategy. We now decode the JWE
 * directly using @auth/core/jwt decode(), which is Auth.js's own public API.
 *
 * IMPORTANT: The salt passed to decode() MUST equal the cookie name exactly.
 *   - HTTPS path: "__Secure-authjs.session-token"
 *   - HTTP/LAN path: "authjs.session-token"
 * Mismatched salt → silent null return (not a thrown error).
 *
 * ⚠ WARNING: If a future refactor changes Auth.js session strategy (e.g. back to
 * "database"), this plugin MUST be updated in the same commit. The decode() call
 * below is tightly coupled to the web app's session: { strategy: "jwt" } setting
 * in apps/web/auth.ts.
 *
 * Sets req.user = { id, email } on success.
 * Returns 401 on failure.
 */

import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { decode } from "@auth/core/jwt";

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

const SECURE_COOKIE_NAME = "__Secure-authjs.session-token";
const PLAIN_COOKIE_NAME = "authjs.session-token";

const verifySessionPluginImpl: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Public endpoints skip authentication
    if (request.url === "/healthz") return;

    const secret = process.env["AUTH_SECRET"];
    if (!secret) {
      reply.status(500).send({ error: "AUTH_SECRET not configured" });
      return;
    }

    // 1) Try Bearer JWT (programmatic access) — unchanged
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

    // 2) Try Auth.js session cookie (JWE — decoded in-process, no DB lookup)
    const cookies = parseCookies(request.headers.cookie ?? "");

    // Determine which cookie is present and record its name (= the salt).
    // The salt MUST match the cookie name or decode() returns null silently.
    let sessionToken: string | undefined;
    let cookieName: string | undefined;

    if (cookies[SECURE_COOKIE_NAME]) {
      sessionToken = cookies[SECURE_COOKIE_NAME];
      cookieName = SECURE_COOKIE_NAME;
    } else if (cookies[PLAIN_COOKIE_NAME]) {
      sessionToken = cookies[PLAIN_COOKIE_NAME];
      cookieName = PLAIN_COOKIE_NAME;
    }

    if (!sessionToken || !cookieName) {
      reply.status(401).send({ error: "Unauthenticated" });
      return;
    }

    try {
      const payload = await decode({
        token: sessionToken,
        secret,
        salt: cookieName,
      });

      if (!payload) {
        reply.status(401).send({ error: "Invalid or expired session" });
        return;
      }

      const id = payload.id as string | undefined;
      const email = payload.email as string | undefined;

      if (!id || !email) {
        reply.status(401).send({ error: "Invalid or expired session" });
        return;
      }

      request.user = { id, email };
    } catch {
      reply.status(401).send({ error: "Invalid or expired session" });
    }
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
