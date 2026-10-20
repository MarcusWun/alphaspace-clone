import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRedis } from "../setup.js";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";

const mockSearchFn = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: mockSearchFn })),
}));

const SECRET = process.env["AUTH_SECRET"]!;
const authHeader = `Bearer ${jwt.sign({ sub: "user-1", email: "test@example.com" }, SECRET, { expiresIn: "1h" })}`;

beforeEach(() => {
  mockSearchFn.mockReset();
});

describe("Nonsense symbol → empty array, no 500", () => {
  it("returns 200 with empty data array for an unknown symbol (Yahoo throws)", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    // Yahoo throws on unknown symbols
    mockSearchFn.mockRejectedValueOnce(new Error("No data found for symbol XYZZZ"));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/company-news?symbol=XYZZZ&from=2025-09-01&to=2025-09-30",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
    await app.close();
  });

  it("returns 200 with empty data array when Yahoo returns no news", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockSearchFn.mockResolvedValueOnce({ news: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/company-news?symbol=XYZZZ&from=2025-09-01&to=2025-09-30",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body.data).toEqual([]);
    await app.close();
  });
});
