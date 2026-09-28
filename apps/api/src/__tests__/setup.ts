/**
 * Global test setup for API tests.
 *
 * Sets required env vars before any test runs.
 * Uses in-memory mocks for Prisma and Redis — no real DB/cache needed for unit tests.
 * Integration tests that need a real DB/Redis are gated by TEST_INTEGRATION=true.
 */

import { vi, afterEach } from "vitest";

// Set required env vars
process.env["AUTH_SECRET"] = "test-secret-32-bytes-long-enough-1234";
process.env["AUTH_URL"] = "http://localhost:3000";
process.env["FINNHUB_API_KEY"] = "test_finnhub_key_NOT_REAL";
process.env["DATABASE_URL"] = "postgresql://alpha:alpha@localhost:5432/alpha_test";
process.env["REDIS_URL"] = "redis://localhost:6379";
process.env["NODE_ENV"] = "test";

// ─── Prisma mock ─────────────────────────────────────────────────────────────

export const mockPrisma = {
  workspace: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  watchlist: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  session: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) =>
    Promise.all(ops)
  ),
};

vi.mock("@alpha/db", () => ({
  prisma: mockPrisma,
}));

// ─── Redis mock ───────────────────────────────────────────────────────────────
// Pre-define `rateLimit` and `rateLimitRead` so @fastify/rate-limit's
// `if (!this.redis.rateLimit)` guard skips `defineCommand` entirely.
// Both functions call the last argument as a callback with [0, 0] (never throttled).

export const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  ping: vi.fn().mockResolvedValue("PONG"),
  publish: vi.fn().mockResolvedValue(0),
  quit: vi.fn().mockResolvedValue("OK"),
  defineCommand: vi.fn(),
  rateLimit: vi.fn().mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: [number, number]) => void;
    cb(null, [0, 0]);
  }),
  rateLimitRead: vi.fn().mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: [number, number]) => void;
    cb(null, [0, 0]);
  }),
};

vi.mock("../services/redis.js", () => ({
  getRedis: () => mockRedis,
  closeRedis: vi.fn(),
}));

// ─── Fetch mock ───────────────────────────────────────────────────────────────

global.fetch = vi.fn();

// Reset all mocks between tests
afterEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
});
