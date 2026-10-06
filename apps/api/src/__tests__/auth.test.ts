import { describe, it, expect } from "vitest";
import { encode } from "@auth/core/jwt";
import { buildApp } from "../app.js";
import { mockPrisma } from "./setup.js";
import jwt from "jsonwebtoken";

const TEST_SECRET = process.env["AUTH_SECRET"]!;

/**
 * Helper: create a real Auth.js JWE fixture using the same encode() that
 * Auth.js v5 uses on the web side. The salt MUST equal the cookie name.
 */
async function makeJwe(
  payload: Record<string, unknown>,
  opts: { secret?: string; salt?: string; maxAge?: number } = {}
): Promise<string> {
  return encode({
    token: payload,
    secret: opts.secret ?? TEST_SECRET,
    salt: opts.salt ?? "authjs.session-token",
    maxAge: opts.maxAge ?? 3600,
  });
}

describe("verifySession middleware", () => {
  // ─── Pre-existing tests (Bearer JWT + misc) — must remain green ──────────

  it("returns 401 when no session cookie and no Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 with a valid Bearer JWT", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    mockPrisma.workspace.count.mockResolvedValue(1);

    const token = jwt.sign(
      { sub: "user-1", email: "user1@example.com" },
      TEST_SECRET,
      { expiresIn: "1h" }
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 with an invalid Bearer JWT", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { authorization: "Bearer totally-invalid-token" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  // ─── JWE cookie tests (regression for AUTH-MISMATCH 2026-10-05) ─────────

  it("returns 200 with a valid Auth.js JWE in authjs.session-token cookie (HTTP/LAN path)", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    mockPrisma.workspace.count.mockResolvedValue(1);

    const jwe = await makeJwe(
      { id: "user-1", email: "user1@example.com" },
      { salt: "authjs.session-token" }
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: `authjs.session-token=${jwe}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 200 with a valid Auth.js JWE in __Secure-authjs.session-token cookie (HTTPS/Cloudflare path)", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    mockPrisma.workspace.count.mockResolvedValue(1);

    const jwe = await makeJwe(
      { id: "user-1", email: "user1@example.com" },
      { salt: "__Secure-authjs.session-token" }
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: `__Secure-authjs.session-token=${jwe}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 with an expired Auth.js JWE cookie", async () => {
    // maxAge: -60 → exp = iat - 60 (one minute in the past, beyond the
    // 15-second clockTolerance that @auth/core/jwt's jwtDecrypt uses)
    const jwe = await makeJwe(
      { id: "user-1", email: "user1@example.com" },
      { maxAge: -60 }
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: `authjs.session-token=${jwe}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 with a malformed cookie value (not a valid JWE)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: "authjs.session-token=this-is-garbage" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 with a JWE signed with the wrong secret", async () => {
    const jwe = await makeJwe(
      { id: "user-1", email: "user1@example.com" },
      { secret: "completely-different-secret-value-abcd" }
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: `authjs.session-token=${jwe}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
