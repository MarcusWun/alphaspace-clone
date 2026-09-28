import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { mockPrisma } from "./setup.js";
import jwt from "jsonwebtoken";

const SECRET = process.env["AUTH_SECRET"]!;

function bearerFor(userId: string, email: string) {
  return `Bearer ${jwt.sign({ sub: userId, email }, SECRET, { expiresIn: "1h" })}`;
}

const user1 = { id: "user-1", email: "alice@example.com" };
const user2 = { id: "user-2", email: "bob@example.com" };

const sampleWatchlist = {
  id: "wl-1",
  userId: user1.id,
  name: "My Watchlist",
  tickers: ["AAPL", "NVDA"],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Watchlist routes", () => {
  describe("GET /api/watchlists", () => {
    it("returns watchlists for the authenticated user", async () => {
      mockPrisma.watchlist.findMany.mockResolvedValue([sampleWatchlist]);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/watchlists",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: typeof sampleWatchlist[] }>();
      expect(body.data[0]?.id).toBe("wl-1");
      expect(mockPrisma.watchlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: user1.id } })
      );
      await app.close();
    });

    it("user2 cannot see user1 watchlists (isolation)", async () => {
      mockPrisma.watchlist.findMany.mockResolvedValue([]); // empty for user2

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/watchlists",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[] }>();
      expect(body.data).toHaveLength(0);
      expect(mockPrisma.watchlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: user2.id } })
      );
      await app.close();
    });
  });

  describe("POST /api/watchlists", () => {
    it("normalizes ticker case on create", async () => {
      mockPrisma.watchlist.create.mockResolvedValue(sampleWatchlist);

      const app = await buildApp();
      await app.inject({
        method: "POST",
        url: "/api/watchlists",
        headers: {
          authorization: bearerFor(user1.id, user1.email),
          "content-type": "application/json",
        },
        payload: { name: "test", tickers: ["aapl", " nvda ", "MSFT"] },
      });

      const createCall = mockPrisma.watchlist.create.mock.calls[0];
      expect(createCall?.[0]?.data?.tickers).toEqual(["AAPL", "NVDA", "MSFT"]);
      await app.close();
    });
  });

  describe("GET /api/watchlists/:id", () => {
    it("returns 404 for another user's watchlist", async () => {
      mockPrisma.watchlist.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/watchlists/wl-1",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });
});
