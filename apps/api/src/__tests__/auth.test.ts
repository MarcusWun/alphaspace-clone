import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { mockPrisma } from "./setup.js";
import jwt from "jsonwebtoken";

const TEST_SECRET = process.env["AUTH_SECRET"]!;

function validSession(userId: string, email: string) {
  return {
    sessionToken: "test-session-token",
    userId,
    expires: new Date(Date.now() + 3_600_000),
    user: { id: userId, email },
  };
}

describe("verifySession middleware", () => {
  it("returns 401 when no session cookie and no Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 with a valid session cookie", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      validSession("user-1", "user1@example.com")
    );
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    mockPrisma.workspace.count.mockResolvedValue(1); // prevent seed

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: "authjs.session-token=test-session-token" },
    });
    expect(res.statusCode).toBe(200);
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

  it("returns 401 with an expired session", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      sessionToken: "expired-token",
      userId: "user-1",
      expires: new Date(Date.now() - 1000), // already expired
      user: { id: "user-1", email: "user1@example.com" },
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: { cookie: "authjs.session-token=expired-token" },
    });
    expect(res.statusCode).toBe(401);
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
});
