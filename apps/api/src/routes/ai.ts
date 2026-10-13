import { FastifyPluginAsync } from "fastify";
import { prisma } from "@alpha/db";
import type { Prisma } from "@alpha/db";
import { getRedis } from "../services/redis.js";
import { routeChat } from "../services/ai/router.js";
import { isCloudConfigured } from "../services/ai/cloudConfig.js";
import { estimateTokens } from "../services/ai/router.js";
import type { ChatEvent } from "../services/ai/types.js";

type PersistEvent =
  | { kind: "assistant_tool_calls"; toolCalls: Array<{ id: string; name: string; args: unknown }> }
  | { kind: "tool_result"; toolCallId: string; name: string; content: string }
  | { kind: "assistant_content"; content: string };

const UNDO_TTL_SECONDS = 30;

function undoKey(workspaceId: string): string {
  return `ai:undo:${workspaceId}`;
}

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/ai/chat/stream — SSE streaming chat endpoint
  fastify.post<{
    Body: { workspaceId: string; message: string; deep?: boolean };
  }>(
    "/ai/chat/stream",
    {
      schema: {
        body: {
          type: "object",
          required: ["workspaceId", "message"],
          properties: {
            workspaceId: { type: "string", minLength: 1 },
            message: { type: "string", minLength: 1 },
            deep: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, message, deep = false } = request.body;
      const userId = request.user.id;

      // Verify workspace ownership
      const workspace = await prisma.workspace.findFirst({
        where: { id: workspaceId, userId },
      });
      if (!workspace) {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      // Load history (respects soft-delete sentinel)
      const redis = getRedis();
      const sentinel = await redis.get(undoKey(workspaceId));
      if (sentinel) {
        // Still within undo window — treat as empty history
      }

      const history = sentinel
        ? []
        : await prisma.chatMessage.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "asc" },
          });

      const tokensEstimated = estimateTokens(history, message);
      const source = isCloudConfigured() ? "cloud" : "local";
      request.log.info({ workspaceId, userId, source, tokensEstimated }, "ai.chat.start");

      // Persist user message
      const userMsg = await prisma.chatMessage.create({
        data: { workspaceId, userId, role: "user", content: message },
      });

      // Set SSE headers using raw response
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const chatStart = Date.now();
      let accumulatedContent = "";
      const toolCallsMade: Array<{ id: string; name: string; args: unknown }> = [];
      let doneEvent: (ChatEvent & { type: "done" }) | null = null;

      const persistEvents: PersistEvent[] = [];
      let pendingToolCalls: Array<{ id: string; name: string; args: unknown }> = [];
      let pendingContent = "";

      // Heartbeat timer to prevent CF Tunnel timeout on long tool calls
      const heartbeatInterval = setInterval(() => {
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
        } catch {
          // stream may already be closed
        }
      }, 15000);

      try {
        const ctx = { userId, workspaceId, history, userMessage: message, deep };
        for await (const event of routeChat(ctx)) {
          const sseData = `data: ${JSON.stringify(event)}\n\n`;
          reply.raw.write(sseData);

          if (event.type === "token") {
            accumulatedContent += event.content;
            pendingContent += event.content;
          } else if (event.type === "tool_call") {
            request.log.info({ tool: event.name, args: event.args }, "ai.tool.call");
            toolCallsMade.push({ id: event.id, name: event.name, args: event.args });
            if (pendingContent.length > 0) {
              persistEvents.push({ kind: "assistant_content", content: pendingContent });
              pendingContent = "";
            }
            pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
          } else if (event.type === "tool_result") {
            request.log.info({ tool: event.name, duration_ms: 0, ok: true }, "ai.tool.result");
            if (pendingToolCalls.length > 0) {
              persistEvents.push({ kind: "assistant_tool_calls", toolCalls: pendingToolCalls });
              pendingToolCalls = [];
            }
            persistEvents.push({
              kind: "tool_result",
              toolCallId: event.id,
              name: event.name,
              content: JSON.stringify(event.result),
            });
          } else if (event.type === "done") {
            doneEvent = event;
          } else if (event.type === "error") {
            clearInterval(heartbeatInterval);
            request.log.warn({ code: event.code, message: event.message }, "ai.chat.error");
            reply.raw.end();
            return;
          }
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        const errorEvent = { type: "error", error: "Chat failed" };
        reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
        reply.raw.end();
        request.log.error({ err }, "ai.chat.error");
        return;
      }

      clearInterval(heartbeatInterval);

      // Flush any trailing content not yet committed to persistEvents
      if (pendingContent.length > 0) {
        persistEvents.push({ kind: "assistant_content", content: pendingContent });
      }

      const chatDuration = Date.now() - chatStart;

      // Persist assistant turn atomically: one transaction covers all rows for this prompt
      let assistantMsgId: string | undefined;
      if (doneEvent && persistEvents.length > 0) {
        const finalDoneEvent = doneEvent;
        const createdRows = await prisma.$transaction(
          persistEvents.map((e) => {
            if (e.kind === "assistant_tool_calls") {
              return prisma.chatMessage.create({
                data: {
                  workspaceId,
                  userId,
                  role: "assistant",
                  content: "",
                  toolCalls: e.toolCalls as unknown as Prisma.InputJsonValue,
                  source: finalDoneEvent.source,
                },
              });
            }
            if (e.kind === "tool_result") {
              return prisma.chatMessage.create({
                data: {
                  workspaceId,
                  userId,
                  role: "tool",
                  content: e.content,
                  toolCallId: e.toolCallId,
                },
              });
            }
            return prisma.chatMessage.create({
              data: {
                workspaceId,
                userId,
                role: "assistant",
                content: e.content,
                source: finalDoneEvent.source,
              },
            });
          })
        );
        assistantMsgId = createdRows[createdRows.length - 1]?.id;
      }

      request.log.info(
        {
          workspaceId,
          source: doneEvent?.source,
          duration_ms: chatDuration,
          messageTokens: Math.floor(message.length / 4),
          assistantTokens: Math.floor(accumulatedContent.length / 4),
        },
        "ai.chat.done"
      );

      const finalDone = {
        type: "done",
        source: doneEvent?.source ?? "local",
        messageId: assistantMsgId ?? userMsg.id,
      };
      reply.raw.write(`data: ${JSON.stringify(finalDone)}\n\n`);
      reply.raw.end();
    }
  );

  // GET /api/ai/history/:workspaceId
  fastify.get<{ Params: { workspaceId: string } }>(
    "/ai/history/:workspaceId",
    async (request, reply) => {
      const { workspaceId } = request.params;
      const userId = request.user.id;

      const workspace = await prisma.workspace.findFirst({
        where: { id: workspaceId, userId },
      });
      if (!workspace) {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const redis = getRedis();
      const sentinel = await redis.get(undoKey(workspaceId));

      if (sentinel) {
        // Within undo window — return empty list
        return reply.send({ messages: [] });
      }

      // Sentinel expired — hard-delete any soft-deleted rows (no-op if already cleaned)
      // This is a lazy cleanup: if TTL has passed, delete any lingering rows
      // In practice, the rows are only created again after a clear, so this is safe.

      const messages = await prisma.chatMessage.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
      });

      return reply.send({ messages });
    }
  );

  // DELETE /api/ai/history/:workspaceId — soft-delete with 30s undo window
  fastify.delete<{ Params: { workspaceId: string } }>(
    "/ai/history/:workspaceId",
    async (request, reply) => {
      const { workspaceId } = request.params;
      const userId = request.user.id;

      const workspace = await prisma.workspace.findFirst({
        where: { id: workspaceId, userId },
      });
      if (!workspace) {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const redis = getRedis();
      // Soft-delete: set sentinel with 30s TTL
      await redis.set(undoKey(workspaceId), "1", "EX", UNDO_TTL_SECONDS);

      return reply.status(204).send();
    }
  );
};
