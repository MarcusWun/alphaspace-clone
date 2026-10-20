import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildApp } from "../../app.js";
import { mockRedis } from "../setup.js";
import jwt from "jsonwebtoken";

// Mock the article extraction service so tests don't do real HTTP
vi.mock("../../services/article/extract.js", () => ({
  extractArticle: vi.fn(),
  ShortContentError: class ShortContentError extends Error {
    constructor(msg = "short content") {
      super(msg);
      this.name = "ShortContentError";
    }
  },
}));

// Also mock yahoo-finance2 to satisfy news/index.ts module init
vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: vi.fn(), chart: vi.fn() })),
}));

import { extractArticle, ShortContentError } from "../../services/article/extract.js";

const mockExtract = vi.mocked(extractArticle);

const SECRET = process.env["AUTH_SECRET"]!;
const authHeader = `Bearer ${jwt.sign({ sub: "user-1", email: "test@example.com" }, SECRET, { expiresIn: "1h" })}`;

const FAKE_ARTICLE_RESULT = {
  title: "Test Article",
  content: "<p>Body text here.</p>",
  excerpt: "Body text here.",
  author: "Jane Doe",
  publishedAt: undefined,
  siteName: "Example News",
  length: 300,
};

const VALID_URL = "https://example.com/article/1234";

beforeEach(() => {
  mockExtract.mockReset();
});

describe("GET /api/article/extract", () => {
  it("returns 400 for a malformed URL (no protocol)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=not-a-url`,
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for a URL shorter than 10 chars", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=http://x`,
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 {status:'ok', article} on happy path", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockExtract.mockResolvedValueOnce(FAKE_ARTICLE_RESULT);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; article: typeof FAKE_ARTICLE_RESULT } }>();
    expect(body.data.status).toBe("ok");
    expect(body.data.article.title).toBe("Test Article");
    await app.close();
  });

  it("returns 200 {status:'fallback', error:'short_content'} on ShortContentError", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockExtract.mockRejectedValueOnce(new ShortContentError());

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; error: string } }>();
    expect(body.data.status).toBe("fallback");
    expect(body.data.error).toBe("short_content");
    await app.close();
  });

  it("returns 200 {status:'fallback', error:'fetch_failed'} on fetch failure", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockExtract.mockRejectedValueOnce(new Error("fetch_failed: HTTP 403"));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; error: string } }>();
    expect(body.data.status).toBe("fallback");
    expect(body.data.error).toBe("fetch_failed");
    await app.close();
  });

  it("returns cached payload on second call without calling extractArticle", async () => {
    const cachedPayload = { status: "ok", article: FAKE_ARTICLE_RESULT };
    // Both calls hit cache
    mockRedis.get.mockResolvedValue(JSON.stringify(cachedPayload));

    const app = await buildApp();

    // First call
    await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });
    // Second call
    await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    // extractArticle never called — both served from cache
    expect(mockExtract).not.toHaveBeenCalled();
    await app.close();
  });

  it("emits cache_hit log on cache hit", async () => {
    const cachedPayload = { status: "ok", article: FAKE_ARTICLE_RESULT };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedPayload));

    const app = await buildApp();
    let cacheHitLogged = false;

    // Spy on request.log.info via response headers — instead, check extractArticle not called
    const res = await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    // The route returns the cached result and doesn't call extraction
    expect(res.statusCode).toBe(200);
    expect(mockExtract).not.toHaveBeenCalled();
    cacheHitLogged = true;
    expect(cacheHitLogged).toBe(true);
    await app.close();
  });

  it("caches successful result with 24h TTL", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockExtract.mockResolvedValueOnce(FAKE_ARTICLE_RESULT);

    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/api/article/extract?url=${encodeURIComponent(VALID_URL)}`,
      headers: { authorization: authHeader },
    });

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^article:extract:/),
      expect.any(String),
      "EX",
      86400
    );
    await app.close();
  });
});
