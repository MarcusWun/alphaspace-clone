import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { mockPrisma, mockRedis } from "./setup.js";

describe("GET /healthz", () => {
  it("returns 200 with status ok when all checks pass", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockRedis.ping.mockResolvedValue("PONG");

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      status: string;
      checks: { postgres: string; redis: string };
    }>();
    expect(body.status).toBe("ok");
    expect(body.checks.postgres).toBe("ok");
    expect(body.checks.redis).toBe("ok");
    await app.close();
  });

  it("returns 503 with degraded status when postgres fails", async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
    mockRedis.ping.mockResolvedValue("PONG");

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(503);
    const body = res.json<{ status: string; checks: { postgres: string } }>();
    expect(body.status).toBe("degraded");
    expect(body.checks.postgres).toBe("fail");
    await app.close();
  });

  it("returns 503 with degraded status when redis fails", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockRedis.ping.mockRejectedValue(new Error("connection refused"));

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(503);
    const body = res.json<{ status: string; checks: { redis: string } }>();
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("fail");
    await app.close();
  });

  it("does not require authentication", async () => {
    const app = await buildApp();
    // No cookie, no auth header — healthz should still work
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
