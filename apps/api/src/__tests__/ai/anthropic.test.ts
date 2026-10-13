import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamAnthropicResponse } from "../../services/ai/anthropic.js";
import type { RouterContext } from "../../services/ai/types.js";

vi.mock("../../services/ai/tools.js", () => ({
  openAiTools: [],
  anthropicTools: [],
  dispatchTool: vi.fn(),
}));

import { dispatchTool } from "../../services/ai/tools.js";
const mockDispatch = vi.mocked(dispatchTool);

function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    userId: "user-1",
    workspaceId: "ws-1",
    history: [],
    userMessage: "What is NVDA?",
    deep: false,
    ...overrides,
  };
}

function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function textDeltaEvent(text: string): string {
  return `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}`;
}

function messageStopEvent(): string {
  return `data: ${JSON.stringify({ type: "message_stop" })}`;
}

async function collectEvents(gen: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-testkey-very-long-enough-1234567890");
  vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
});

describe("streamAnthropicResponse", () => {
  it("sends correct request headers and body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([textDeltaEvent("Hello"), messageStopEvent()]),
    }) as typeof fetch;

    await collectEvents(streamAnthropicResponse(makeCtx()));

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-api03-testkey-very-long-enough-1234567890"
    );
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
    };
    expect(body.model).toBe("claude-test-model");
    expect(body.stream).toBe(true);
  });

  it("emits token events and done with source:cloud", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        textDeltaEvent("Hello"),
        textDeltaEvent(" world"),
        messageStopEvent(),
      ]),
    }) as typeof fetch;

    const events = await collectEvents(streamAnthropicResponse(makeCtx()));

    const tokens = events.filter((e) => (e as { type: string }).type === "token");
    expect(tokens).toHaveLength(2);

    const done = events.find((e) => (e as { type: string }).type === "done");
    expect((done as { source: string }).source).toBe("cloud");
  });

  it("throws when Anthropic returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }) as typeof fetch;

    await expect(collectEvents(streamAnthropicResponse(makeCtx()))).rejects.toThrow(
      "Anthropic error 401"
    );
  });

  it("emits tool_call + tool_result when model uses a tool", async () => {
    mockDispatch.mockResolvedValue({ ok: true, result: { c: 500 } });

    const firstStream = makeSSEStream([
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu-1", name: "get_quote" } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"symbol":"NVDA"}' } })}`,
      messageStopEvent(),
    ]);

    const secondStream = makeSSEStream([
      textDeltaEvent("NVDA is $500"),
      messageStopEvent(),
    ]);

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        body: callCount === 1 ? firstStream : secondStream,
      });
    }) as typeof fetch;

    const events = await collectEvents(streamAnthropicResponse(makeCtx()));

    const toolCall = events.find((e) => (e as { type: string }).type === "tool_call");
    expect(toolCall).toBeDefined();
    expect((toolCall as { name: string }).name).toBe("get_quote");
    expect(mockDispatch).toHaveBeenCalledWith("get_quote", { symbol: "NVDA" });

    const done = events.find((e) => (e as { type: string }).type === "done");
    expect((done as { source: string }).source).toBe("cloud");
  });

  it("ORDERING-REGRESSION: assistant(tool_use) appears before user(tool_result) in second-turn request, tool_use_id matches", async () => {
    mockDispatch.mockResolvedValue({ ok: true, result: { c: 187.5 } });

    const firstStream = makeSSEStream([
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu-nvda", name: "get_quote" } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"symbol":"NVDA"}' } })}`,
      messageStopEvent(),
    ]);
    const secondStream = makeSSEStream([
      textDeltaEvent("NVDA is $187.50"),
      messageStopEvent(),
    ]);

    const fetchCalls: Array<[string, RequestInit]> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      fetchCalls.push([url, init]);
      return Promise.resolve({
        ok: true,
        body: fetchCalls.length === 1 ? firstStream : secondStream,
      });
    }) as typeof fetch;

    await collectEvents(streamAnthropicResponse(makeCtx()));

    expect(fetchCalls).toHaveLength(2);

    const secondBody = JSON.parse(fetchCalls[1]![1]!.body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const msgs = secondBody.messages;

    // Find the assistant message (carries tool_use content block) and the user message (carries tool_result)
    const assistantIdx = msgs.findIndex(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_use")
    );
    const userIdx = msgs.findIndex(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result")
    );

    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThanOrEqual(0);
    // CRITICAL: assistant(tool_use) MUST appear before user(tool_result)
    expect(assistantIdx).toBeLessThan(userIdx);

    // tool_use_id in the tool_result block must reference the tool_use id
    const userMsg = msgs[userIdx] as { content: Array<{ type: string; tool_use_id?: string }> };
    const toolResultBlock = userMsg.content.find((b) => b.type === "tool_result");
    expect(toolResultBlock?.tool_use_id).toBe("tu-nvda");
  });
});
