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

const sampleWorkspace = {
  id: "ws-1",
  userId: user1.id,
  name: "My Workspace",
  layout: { panels: [], grid: [] },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Workspace routes", () => {
  describe("GET /api/workspaces", () => {
    it("returns workspaces for the authenticated user", async () => {
      mockPrisma.workspace.count.mockResolvedValue(1); // skip seed
      mockPrisma.workspace.findMany.mockResolvedValue([sampleWorkspace]);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: typeof sampleWorkspace[] }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe("ws-1");
      expect(mockPrisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: user1.id } })
      );
      await app.close();
    });

    it("user2 cannot see user1 workspaces (isolation)", async () => {
      mockPrisma.workspace.count.mockResolvedValue(1);
      mockPrisma.workspace.findMany.mockResolvedValue([]); // no workspaces for user2

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[] }>();
      expect(body.data).toHaveLength(0);
      // Ensure query was filtered by user2's ID, not user1's
      expect(mockPrisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: user2.id } })
      );
      await app.close();
    });

    it("seeds starter workspace if user has none", async () => {
      mockPrisma.workspace.count.mockResolvedValue(0);
      mockPrisma.workspace.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockResolvedValue([]);

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      await app.close();
    });

    it("does not seed when user already has workspaces (idempotency)", async () => {
      mockPrisma.workspace.count.mockResolvedValue(1);
      mockPrisma.workspace.findMany.mockResolvedValue([sampleWorkspace]);

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });
      await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      // $transaction should never be called since count > 0
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("POST /api/workspaces", () => {
    it("creates a workspace for the authenticated user", async () => {
      mockPrisma.workspace.create.mockResolvedValue(sampleWorkspace);

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          authorization: bearerFor(user1.id, user1.email),
          "content-type": "application/json",
        },
        payload: { name: "My Workspace" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.workspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: user1.id }),
        })
      );
      await app.close();
    });

    it("rejects missing name (validation)", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          authorization: bearerFor(user1.id, user1.email),
          "content-type": "application/json",
        },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("GET /api/workspaces/:id", () => {
    it("returns 404 when workspace belongs to another user", async () => {
      // findFirst returns null because userId filter doesn't match
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces/ws-1",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("PUT /api/workspaces/:id — layout sanitization", () => {
    it("drops unknown panel IDs from layout grid on restore", async () => {
      // Workspace exists for user1
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
      mockPrisma.workspace.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...sampleWorkspace, ...data })
      );

      const app = await buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/api/workspaces/ws-1",
        headers: {
          authorization: bearerFor(user1.id, user1.email),
          "content-type": "application/json",
        },
        payload: {
          layout: {
            panels: [{ id: "panel-known", type: "watchlist" }],
            grid: [
              { i: "panel-known", x: 0, y: 0, w: 4, h: 4 },
              // This grid item has an unknown panel ID — must be dropped
              { i: "panel-UNKNOWN", x: 4, y: 0, w: 4, h: 4 },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const updateCall = mockPrisma.workspace.update.mock.calls[0];
      const savedLayout = updateCall?.[0]?.data?.layout as {
        panels: Array<{ id: string }>;
        grid: Array<{ i: string }>;
      };
      expect(savedLayout.grid).toHaveLength(1);
      expect(savedLayout.grid[0]?.i).toBe("panel-known");
      await app.close();
    });
  });

  describe("DELETE /api/workspaces/:id", () => {
    it("deletes workspace for owner", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
      mockPrisma.workspace.delete.mockResolvedValue(sampleWorkspace);

      const app = await buildApp();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/workspaces/ws-1",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(204);
      await app.close();
    });

    it("returns 404 when workspace not found for this user", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/workspaces/ws-1",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });
});
