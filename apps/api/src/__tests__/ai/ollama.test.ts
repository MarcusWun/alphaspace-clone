import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamOllamaResponse } from "../../services/ai/ollama.js";
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
    userMessage: "What is NVDA trading at?",
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

function tokenChunk(content: string): string {
  const chunk = { choices: [{ delta: { content }, finish_reason: null }] };
  return `data: ${JSON.stringify(chunk)}`;
}

function toolCallChunk(id: string, name: string, args: string, finish: boolean): string {
  const chunk = {
    choices: [
      {
        delta: {
          tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
        },
        finish_reason: finish ? "tool_calls" : null,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}`;
}

function doneChunk(): string {
  return "data: [DONE]";
}

async function collectEvents(gen: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
  vi.stubEnv("OLLAMA_MODEL", "test-model");
});

describe("streamOllamaResponse", () => {
  it("emits token events in order and a done event with source:local", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([
        tokenChunk("Hello"),
        tokenChunk(" world"),
        doneChunk(),
      ]),
    });
    global.fetch = mockFetch as typeof fetch;

    const events = await collectEvents(streamOllamaResponse(makeCtx()));

    const tokens = events.filter((e) => (e as { type: string }).type === "token");
    expect(tokens).toHaveLength(2);
    expect((tokens[0] as { content: string }).content).toBe("Hello");
    expect((tokens[1] as { content: string }).content).toBe(" world");

    const done = events.find((e) => (e as { type: string }).type === "done");
    expect(done).toBeDefined();
    expect((done as { source: string }).source).toBe("local");
  });

  it("emits tool_call and tool_result events, appends result, continues", async () => {
    mockDispatch.mockResolvedValue({ ok: true, result: { c: 500 } });

    // First response: tool call request
    const firstStream = makeSSEStream([
      toolCallChunk("tc-1", "get_quote", '{"symbol":"NVDA"}', true),
      doneChunk(),
    ]);

    // Second response: answer after tool result
    const secondStream = makeSSEStream([
      tokenChunk("NVDA is at $500"),
      doneChunk(),
    ]);

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        body: callCount === 1 ? firstStream : secondStream,
      });
    }) as typeof fetch;

    const events = await collectEvents(streamOllamaResponse(makeCtx()));

    const toolCall = events.find((e) => (e as { type: string }).type === "tool_call");
    expect(toolCall).toBeDefined();
    expect((toolCall as { name: string }).name).toBe("get_quote");

    const toolResult = events.find((e) => (e as { type: string }).type === "tool_result");
    expect(toolResult).toBeDefined();
    expect((toolResult as { result: unknown }).result).toEqual({ c: 500 });

    expect(mockDispatch).toHaveBeenCalledWith("get_quote", { symbol: "NVDA" });

    const done = events.find((e) => (e as { type: string }).type === "done");
    expect((done as { source: string }).source).toBe("local");
  });

  it("throws when Ollama returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }) as typeof fetch;

    await expect(collectEvents(streamOllamaResponse(makeCtx()))).rejects.toThrow("Ollama error 503");
  });

  it("ORDERING-REGRESSION: assistant(tool_calls) appears before tool-role messages in second-turn request", async () => {
    mockDispatch.mockResolvedValue({ ok: true, result: { c: 187.5 } });

    const firstStream = makeSSEStream([
      toolCallChunk("tc-1", "get_quote", '{"symbol":"NVDA"}', true),
      doneChunk(),
    ]);
    const secondStream = makeSSEStream([
      tokenChunk("NVDA is $187.50"),
      doneChunk(),
    ]);

    const fetchCalls: Array<[string, RequestInit]> = [];
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      fetchCalls.push([url, init]);
      return Promise.resolve({
        ok: true,
        body: fetchCalls.length === 1 ? firstStream : secondStream,
      });
    }) as typeof fetch;

    const events = await collectEvents(streamOllamaResponse(makeCtx()));

    // Two fetch calls: first turn (user message) + second turn (after tool result)
    expect(fetchCalls).toHaveLength(2);

    const secondBody = JSON.parse(fetchCalls[1]![1]!.body as string) as {
      messages: Array<{ role: string; tool_calls?: unknown[]; tool_call_id?: string }>;
    };
    const msgs = secondBody.messages;

    // Find the assistant-with-tool_calls message and the first tool-role message
    const assistantIdx = msgs.findIndex((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    const toolIdx = msgs.findIndex((m) => m.role === "tool" && m.tool_call_id === "tc-1");

    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    // CRITICAL: assistant MUST appear before the tool-role message
    expect(assistantIdx).toBeLessThan(toolIdx);

    // Final event is done with source:local
    const done = events.find((e) => (e as { type: string }).type === "done");
    expect((done as { source: string }).source).toBe("local");
  });

  it("TIMEOUT-REGRESSION: emits error event and ai.ollama.timeout log when fetch times out", async () => {
    vi.stubEnv("OLLAMA_REQUEST_TIMEOUT_MS", "50");

    // Return a pre-aborted signal so the test runs instantly without real timer delay
    const controller = new AbortController();
    // DOMException(message, name) — second arg sets .name; DOMException.name is read-only
    const timeoutErr = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    controller.abort(timeoutErr);
    const abortSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);

    // fetch receives an already-aborted signal and rejects immediately
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      const sig = opts?.signal;
      if (sig?.aborted) {
        return Promise.reject(sig.reason ?? timeoutErr);
      }
      return new Promise(() => {}); // hang — should not be reached
    }) as typeof fetch;

    const warnSpy = vi.spyOn(console, "warn");

    const events = await collectEvents(streamOllamaResponse(makeCtx()));

    // Generator must terminate and yield an error event
    const errEvent = events.find((e) => (e as { type: string }).type === "error") as
      | { type: "error"; source: string; code: string }
      | undefined;
    expect(errEvent).toBeDefined();
    expect(errEvent?.source).toBe("local");
    expect(errEvent?.code).toBe("ollama_timeout");

    // Structured log line must be emitted
    const warnCalls = warnSpy.mock.calls.map((c) => c[0] as string);
    const timeoutLog = warnCalls.find((s) => s.includes("ai.ollama.timeout"));
    expect(timeoutLog).toBeDefined();
    const parsed = JSON.parse(timeoutLog!) as { event: string; model: string; timeout_ms: number };
    expect(parsed.event).toBe("ai.ollama.timeout");
    expect(parsed.model).toBe("test-model");
    expect(parsed.timeout_ms).toBe(50);

    abortSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
