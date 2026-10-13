import { describe, it, expect } from "vitest";
import { sanitizeHistory } from "../../services/ai/historyLoader.js";
import type { ChatMessage } from "@alpha/db";

function makeRow(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    workspaceId: "ws-1",
    userId: "user-1",
    role: "user",
    content: "",
    source: null,
    toolCalls: null,
    toolCallId: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  } as ChatMessage;
}

describe("sanitizeHistory", () => {
  it("well-formed history passes through unchanged with no log", () => {
    const rows: ChatMessage[] = [
      makeRow({ id: "r1", role: "user", content: "What is NVDA?" }),
      makeRow({ id: "r2", role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_quote", args: {} }] as unknown as ChatMessage["toolCalls"] }),
      makeRow({ id: "r3", role: "tool", content: '{"c":226}', toolCallId: "c1" }),
      makeRow({ id: "r4", role: "assistant", content: "NVDA $226", toolCalls: null }),
      makeRow({ id: "r5", role: "user", content: "Thanks" }),
    ];

    const logs: unknown[] = [];
    const logger = { info: (obj: unknown) => logs.push(obj) };

    const result = sanitizeHistory(rows, "ws-1", logger);

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(logs).toHaveLength(0);
  });

  it("malformed assistant (missing tool row) is dropped and logged; subsequent well-formed turns pass through", () => {
    const rows: ChatMessage[] = [
      makeRow({ id: "r1", role: "user", content: "prompt 1" }),
      makeRow({ id: "r2", role: "assistant", content: "", toolCalls: [{ id: "c1" }] as unknown as ChatMessage["toolCalls"] }),
      // next row is user, not tool — mismatch
      makeRow({ id: "r3", role: "user", content: "prompt 2" }),
      makeRow({ id: "r4", role: "assistant", content: "", toolCalls: [{ id: "c2" }] as unknown as ChatMessage["toolCalls"] }),
      makeRow({ id: "r5", role: "tool", content: '{"ok":true}', toolCallId: "c2" }),
      makeRow({ id: "r6", role: "assistant", content: "ok", toolCalls: null }),
    ];

    const logs: unknown[] = [];
    const logger = { info: (obj: unknown) => logs.push(obj) };

    const result = sanitizeHistory(rows, "ws-1", logger);

    expect(result.map((r) => r.id)).toEqual(["r1", "r3", "r4", "r5", "r6"]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      event: "ai.history.sanitized",
      workspaceId: "ws-1",
      orphaned_assistant_rows: 1,
      orphaned_tool_rows: 0,
    });
  });

  it("multi-tool-call well-formed passes through with no log", () => {
    const rows: ChatMessage[] = [
      makeRow({ id: "r1", role: "user", content: "compare" }),
      makeRow({ id: "r2", role: "assistant", content: "", toolCalls: [{ id: "c1" }, { id: "c2" }] as unknown as ChatMessage["toolCalls"] }),
      makeRow({ id: "r3", role: "tool", content: '{"c":226}', toolCallId: "c1" }),
      makeRow({ id: "r4", role: "tool", content: '{"pe":50}', toolCallId: "c2" }),
      makeRow({ id: "r5", role: "assistant", content: "both done", toolCalls: null }),
    ];

    const logs: unknown[] = [];
    const logger = { info: (obj: unknown) => logs.push(obj) };

    const result = sanitizeHistory(rows, "ws-1", logger);

    expect(result.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(logs).toHaveLength(0);
  });

  it("multi-tool-call partial match: orphaned assistant and its partial tool row are both dropped", () => {
    const rows: ChatMessage[] = [
      makeRow({ id: "r1", role: "user", content: "prompt" }),
      makeRow({ id: "r2", role: "assistant", content: "", toolCalls: [{ id: "c1" }, { id: "c2" }] as unknown as ChatMessage["toolCalls"] }),
      makeRow({ id: "r3", role: "tool", content: '{"c":226}', toolCallId: "c1" }),
      // c2 tool row is missing; next is assistant content instead
      makeRow({ id: "r4", role: "assistant", content: "partial", toolCalls: null }),
    ];

    const logs: unknown[] = [];
    const logger = { info: (obj: unknown) => logs.push(obj) };

    const result = sanitizeHistory(rows, "ws-1", logger);

    // Only the user row survives; the orphaned assistant, its partial tool row, and the
    // trailing content assistant all get skipped (no next user row exists after r2)
    expect(result.map((r) => r.id)).toEqual(["r1"]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      event: "ai.history.sanitized",
      workspaceId: "ws-1",
      orphaned_assistant_rows: 1,
      orphaned_tool_rows: 1,
    });
  });
});
