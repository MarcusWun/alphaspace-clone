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

    describe("route reducer persistence", () => {
      const baseMsgShape = (id: string, role: string) => ({
        id,
        workspaceId: "ws-1",
        userId: user1.id,
        role,
        content: "",
        source: null,
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      });

      beforeEach(() => {
        mockPrisma.workspace.findFirst.mockResolvedValue(sampleWorkspace);
        mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      });

      it("single tool call: 1 user create + transaction with [assistant(tool_calls), tool, assistant(content)]", async () => {
        mockPrisma.chatMessage.create
          .mockResolvedValueOnce(baseMsgShape("msg-user", "user"))
          .mockResolvedValueOnce(baseMsgShape("msg-1", "assistant"))
          .mockResolvedValueOnce(baseMsgShape("msg-2", "tool"))
          .mockResolvedValueOnce(baseMsgShape("msg-3", "assistant"));

        mockRouteChat.mockReturnValue(
          makeStream([
            { type: "tool_call", id: "c1", name: "get_quote", args: { symbol: "NVDA" } },
            { type: "tool_result", id: "c1", name: "get_quote", result: { c: 226 } },
            { type: "token", content: "NVDA " },
            { type: "token", content: "is $226" },
            { type: "done", source: "local", messageId: "local-xyz" },
          ]) as ReturnType<typeof routeChat>
        );

        const app = await buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/api/ai/chat/stream",
          headers: { authorization: bearerFor(user1.id, user1.email) },
          payload: { workspaceId: "ws-1", message: "what is NVDA" },
        });

        expect(res.statusCode).toBe(200);
        // 1 user create (pre-stream) + 3 inside the transaction
        expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(4);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

        type CreateCall = [{ data: Record<string, unknown> }];
        const calls = mockPrisma.chatMessage.create.mock.calls as CreateCall[];

        // First call is user row (pre-stream)
        expect(calls[0]![0].data.role).toBe("user");

        // Transaction rows: assistant(tool_calls), tool, assistant(content)
        expect(calls[1]![0].data).toMatchObject({
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "get_quote", args: { symbol: "NVDA" } }],
        });
        expect(calls[2]![0].data).toMatchObject({
          role: "tool",
          toolCallId: "c1",
          content: JSON.stringify({ c: 226 }),
        });
        expect(calls[3]![0].data).toMatchObject({ role: "assistant", content: "NVDA is $226" });
        expect(calls[3]![0].data["toolCalls"]).toBeUndefined();

        // Final SSE done messageId comes from last transaction row
        expect(res.body).toContain('"messageId":"msg-3"');

        await app.close();
      });

      it("multi-tool-call: both tool_calls batched into one assistant row, then tool rows, then content", async () => {
        mockPrisma.chatMessage.create
          .mockResolvedValueOnce(baseMsgShape("msg-user", "user"))
          .mockResolvedValueOnce(baseMsgShape("msg-1", "assistant"))
          .mockResolvedValueOnce(baseMsgShape("msg-2", "tool"))
          .mockResolvedValueOnce(baseMsgShape("msg-3", "tool"))
          .mockResolvedValueOnce(baseMsgShape("msg-4", "assistant"));

        mockRouteChat.mockReturnValue(
          makeStream([
            { type: "tool_call", id: "c1", name: "get_quote", args: { symbol: "NVDA" } },
            { type: "tool_call", id: "c2", name: "get_fundamentals_metric", args: { symbol: "NVDA" } },
            { type: "tool_result", id: "c1", name: "get_quote", result: { c: 226 } },
            { type: "tool_result", id: "c2", name: "get_fundamentals_metric", result: { pe: 50 } },
            { type: "token", content: "NVDA at $226, PE 50" },
            { type: "done", source: "local", messageId: "local-xyz" },
          ]) as ReturnType<typeof routeChat>
        );

        const app = await buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/api/ai/chat/stream",
          headers: { authorization: bearerFor(user1.id, user1.email) },
          payload: { workspaceId: "ws-1", message: "compare NVDA" },
        });

        expect(res.statusCode).toBe(200);
        // 1 user + 4 transaction rows
        expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(5);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

        type CreateCall = [{ data: Record<string, unknown> }];
        const calls = mockPrisma.chatMessage.create.mock.calls as CreateCall[];

        // Single assistant row batching both tool calls (critical: both c1 and c2 together)
        const toolCalls = calls[1]![0].data["toolCalls"] as Array<{ id: string }>;
        expect(toolCalls).toHaveLength(2);
        expect(toolCalls[0]!.id).toBe("c1");
        expect(toolCalls[1]!.id).toBe("c2");
        expect(calls[1]![0].data.content).toBe("");

        // Tool rows in result-order
        expect(calls[2]![0].data).toMatchObject({ role: "tool", toolCallId: "c1" });
        expect(calls[3]![0].data).toMatchObject({ role: "tool", toolCallId: "c2" });

        // Final content assistant
        expect(calls[4]![0].data).toMatchObject({ role: "assistant", content: "NVDA at $226, PE 50" });

        await app.close();
      });

      it("pure content turn: transaction with single assistant row, no tool calls", async () => {
        mockPrisma.chatMessage.create
          .mockResolvedValueOnce(baseMsgShape("msg-user", "user"))
          .mockResolvedValueOnce(baseMsgShape("msg-1", "assistant"));

        mockRouteChat.mockReturnValue(
          makeStream([
            { type: "token", content: "Hello" },
            { type: "token", content: " world" },
            { type: "done", source: "local", messageId: "local-xyz" },
          ]) as ReturnType<typeof routeChat>
        );

        const app = await buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/api/ai/chat/stream",
          headers: { authorization: bearerFor(user1.id, user1.email) },
          payload: { workspaceId: "ws-1", message: "hi" },
        });

        expect(res.statusCode).toBe(200);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        // 1 user create + 1 transaction row
        expect(mockPrisma.chatMessage.create).toHaveBeenCalledTimes(2);

        type CreateCall = [{ data: Record<string, unknown> }];
        const calls = mockPrisma.chatMessage.create.mock.calls as CreateCall[];

        expect(calls[1]![0].data).toMatchObject({ role: "assistant", content: "Hello world" });
        expect(calls[1]![0].data["toolCalls"]).toBeUndefined();

        await app.close();
      });
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
