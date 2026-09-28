/**
 * Watchlist CRUD routes
 *
 * All routes scoped to req.user.id.
 * Tickers are normalized to uppercase and trimmed.
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@alpha/db";

function normalizeTickers(tickers: string[]): string[] {
  return tickers.map((t) => t.trim().toUpperCase()).filter(Boolean);
}

export const watchlistRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/watchlists
  fastify.get("/watchlists", async (request, reply) => {
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ data: watchlists });
  });

  // POST /api/watchlists
  fastify.post<{
    Body: { name: string; tickers?: string[] };
  }>(
    "/watchlists",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            tickers: {
              type: "array",
              items: { type: "string" },
              default: [],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, tickers = [] } = request.body;
      const watchlist = await prisma.watchlist.create({
        data: {
          userId: request.user.id,
          name,
          tickers: normalizeTickers(tickers),
        },
      });
      return reply.status(201).send({ data: watchlist });
    }
  );

  // GET /api/watchlists/:id
  fastify.get<{ Params: { id: string } }>(
    "/watchlists/:id",
    async (request, reply) => {
      const watchlist = await prisma.watchlist.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!watchlist) {
        return reply.status(404).send({ error: "Watchlist not found" });
      }
      return reply.send({ data: watchlist });
    }
  );

  // PUT /api/watchlists/:id
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; tickers?: string[] };
  }>(
    "/watchlists/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            tickers: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const existing = await prisma.watchlist.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Watchlist not found" });
      }

      const { name, tickers } = request.body;
      const updated = await prisma.watchlist.update({
        where: { id: request.params.id },
        data: {
          ...(name !== undefined && { name }),
          ...(tickers !== undefined && { tickers: normalizeTickers(tickers) }),
        },
      });
      return reply.send({ data: updated });
    }
  );

  // DELETE /api/watchlists/:id
  fastify.delete<{ Params: { id: string } }>(
    "/watchlists/:id",
    async (request, reply) => {
      const existing = await prisma.watchlist.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Watchlist not found" });
      }
      await prisma.watchlist.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    }
  );
};
