import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildApp } from "../../app.js";
import { mockPrisma, mockRedis } from "../setup.js";
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
  chartType: "line",
  createdAt: new Date(),
  updatedAt: new Date(),
};

vi.mock("../../services/ai/router.js", () => ({
  routeChat: vi.fn(),
  estimateTokens: vi.fn().mockReturnValue(10),
}));

vi.mock("../../services/ai/cloudConfig.js", () => ({
  isCloudConfigured: vi.fn().mockReturnValue(false),
}));

import { routeChat } from "../../services/ai/router.js";
const mockRouteChat = vi.mocked(routeChat);

async function* makeStream(
  events: Array<{ type: string; [key: string]: unknown }>
): AsyncIterable<{ type: string; [key: string]: unknown }> {
  for (const e of events) {
    yield e as { type: string };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue("OK");
});

describe("AI routes", () => {
  describe("POST /api/ai/chat/stream", () => {
    it("returns 404 when workspace not found", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/ai/chat/stream",
        headers: { authorization: bearerFor(user1.id, user1.email) },
        payload: { workspaceId: "ws-999", message: "hello" },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it("returns 400 on missing required fields", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/ai/chat/stream",
        headers: { authorization: bearerFor(user1.id, user1.email) },
        payload: { workspaceId: "ws-1" }, // missing message
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("streams SSE events for a simple chat", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: "msg-1",
        workspaceId: "ws-1",
        userId: user1.id,
        role: "user",
        content: "hello",
        source: null,
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      });

      mockRouteChat.mockReturnValue(
        makeStream([
          { type: "token", content: "Hi" },
          { type: "token", content: " there" },
          { type: "done", source: "local", messageId: "msg-1" },
        ]) as ReturnType<typeof routeChat>
      );

      // Second create call for assistant message
      mockPrisma.chatMessage.create.mockResolvedValueOnce({
        id: "msg-1",
        workspaceId: "ws-1",
        userId: user1.id,
        role: "user",
        content: "hello",
        source: null,
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      }).mockResolvedValueOnce({
        id: "msg-2",
        workspaceId: "ws-1",
        userId: user1.id,
        role: "assistant",
        content: "Hi there",
        source: "local",
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/ai/chat/stream",
        headers: { authorization: bearerFor(user1.id, user1.email) },
        payload: { workspaceId: "ws-1", message: "hello" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");

      const body = res.body;
      expect(body).toContain("data:");
      expect(body).toContain('"type":"token"');
      await app.close();
    });

    it("user2 cannot access user1 workspace", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null); // user2 has no access to ws-1

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/ai/chat/stream",
        headers: { authorization: bearerFor(user2.id, user2.email) },
        payload: { workspaceId: "ws-1", message: "hello" },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("GET /api/ai/history/:workspaceId", () => {
    it("returns messages ordered by createdAt", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: "m1", role: "user", content: "hello", createdAt: new Date("2026-01-01") },
        { id: "m2", role: "assistant", content: "world", createdAt: new Date("2026-01-02") },
      ]);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/ai/history/ws-1",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ messages: Array<{ id: string }> }>();
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]?.id).toBe("m1");
      await app.close();
    });

    it("returns empty list during soft-delete undo window", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
      mockRedis.get.mockResolvedValue("1"); // sentinel set

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/ai/history/ws-1",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ messages: unknown[] }>();
      expect(body.messages).toHaveLength(0);
      // Should NOT call findMany during undo window
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
      await app.close();
    });

    it("returns 404 for non-owned workspace", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/ai/history/ws-1",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("DELETE /api/ai/history/:workspaceId", () => {
    it("sets Redis sentinel and returns 204", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);

      const app = await buildApp();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/ai/history/ws-1",
        headers: { authorization: bearerFor(user1.id, user1.email) },
      });

      expect(res.statusCode).toBe(204);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "ai:undo:ws-1",
        "1",
        "EX",
        30
      );
      await app.close();
    });

    it("returns 404 for non-owned workspace", async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/ai/history/ws-1",
        headers: { authorization: bearerFor(user2.id, user2.email) },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });
});
