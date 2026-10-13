/**
 * FE-P3A-6 — Unit tests for apps/web/lib/queries/ai.ts
 *
 * Covers:
 * - streamAiChat SSE parser: partial chunks, multi-event reads, heartbeat, done terminates
 * - Non-200 error handling (401, 404, 500)
 * - useAiHistory SSR safety (enabled guard)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { streamAiChat, useAiHistory, type ChatEvent } from "@/lib/queries/ai";

// ── Helpers ───────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function makeSSEStream(events: ChatEvent[], splitAt?: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const chunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
      const full = chunks.join("");
      if (splitAt !== undefined && splitAt < full.length) {
        // Simulate partial chunk split
        controller.enqueue(encoder.encode(full.slice(0, splitAt)));
        controller.enqueue(encoder.encode(full.slice(splitAt)));
      } else {
        controller.enqueue(encoder.encode(full));
      }
      controller.close();
    },
  });
}

function mockFetchWithStream(stream: ReadableStream<Uint8Array>, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    json: () => Promise.resolve({ error: "Server error" }),
    headers: new Headers(),
  });
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── streamAiChat ──────────────────────────────────────────────────────────────

describe("streamAiChat — SSE parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields token events in order", async () => {
    const events: ChatEvent[] = [
      { type: "token", content: "Hello" },
      { type: "token", content: " world" },
      { type: "done", source: "local", messageId: "msg-1" },
    ];
    vi.stubGlobal("fetch", mockFetchWithStream(makeSSEStream(events)));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "hi" })) {
      received.push(ev);
    }

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ type: "token", content: "Hello" });
    expect(received[1]).toEqual({ type: "token", content: " world" });
    expect(received[2]).toEqual({ type: "done", source: "local", messageId: "msg-1" });
  });

  it("handles partial chunk — event split across two reads", async () => {
    const events: ChatEvent[] = [
      { type: "token", content: "Partial" },
      { type: "done", source: "local", messageId: "msg-2" },
    ];
    const full = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    // Split in the middle of the first event
    const splitPoint = Math.floor(full.length / 2);
    const stream = makeSSEStream(events, splitPoint);
    vi.stubGlobal("fetch", mockFetchWithStream(stream));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "hi" })) {
      received.push(ev);
    }

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: "token", content: "Partial" });
    expect(received[1]).toMatchObject({ type: "done" });
  });

  it("handles two events in one read (no split)", async () => {
    const events: ChatEvent[] = [
      { type: "token", content: "A" },
      { type: "token", content: "B" },
      { type: "token", content: "C" },
      { type: "done", source: "local", messageId: "msg-3" },
    ];
    // All events in one chunk (no splitAt)
    vi.stubGlobal("fetch", mockFetchWithStream(makeSSEStream(events)));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "hi" })) {
      received.push(ev);
    }

    expect(received).toHaveLength(4);
    expect(received.map((e) => e.type)).toEqual(["token", "token", "token", "done"]);
  });

  it("yields heartbeat events (no-op, caller should ignore)", async () => {
    const events: ChatEvent[] = [
      { type: "heartbeat" },
      { type: "token", content: "after heartbeat" },
      { type: "done", source: "local", messageId: "msg-4" },
    ];
    vi.stubGlobal("fetch", mockFetchWithStream(makeSSEStream(events)));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "hi" })) {
      received.push(ev);
    }

    expect(received[0]).toEqual({ type: "heartbeat" });
    expect(received[1]).toEqual({ type: "token", content: "after heartbeat" });
    expect(received[2]).toMatchObject({ type: "done" });
  });

  it("terminates after done event (does not yield further)", async () => {
    const events: ChatEvent[] = [
      { type: "token", content: "first" },
      { type: "done", source: "cloud", messageId: "msg-5" },
      // This token should never be yielded
      { type: "token", content: "after done" },
    ];
    vi.stubGlobal("fetch", mockFetchWithStream(makeSSEStream(events)));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "hi" })) {
      received.push(ev);
    }

    // Only 2 events yielded before done terminates the generator
    expect(received).toHaveLength(2);
    expect(received[1]).toMatchObject({ type: "done" });
  });

  it("yields tool_call and tool_result events", async () => {
    const events: ChatEvent[] = [
      { type: "tool_call", id: "tc-1", name: "get_quote", args: { symbol: "NVDA" } },
      { type: "tool_result", id: "tc-1", name: "get_quote", result: { c: 450.25 } },
      { type: "token", content: "NVDA is at 450.25" },
      { type: "done", source: "local", messageId: "msg-6" },
    ];
    vi.stubGlobal("fetch", mockFetchWithStream(makeSSEStream(events)));

    const received: ChatEvent[] = [];
    for await (const ev of streamAiChat({ workspaceId: "ws-1", message: "quote" })) {
      received.push(ev);
    }

    expect(received[0]).toEqual({
      type: "tool_call",
      id: "tc-1",
      name: "get_quote",
      args: { symbol: "NVDA" },
    });
    expect(received[1]).toEqual({
      type: "tool_result",
      id: "tc-1",
      name: "get_quote",
      result: { c: 450.25 },
    });
  });
});

describe("streamAiChat — error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws 'Unauthenticated' on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      })
    );

    const gen = streamAiChat({ workspaceId: "ws-1", message: "hi" });
    await expect(gen.next()).rejects.toThrow("Unauthenticated");
  });

  it("throws 'Workspace not found' on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        body: null,
        json: () => Promise.resolve({ error: "Not found" }),
      })
    );

    const gen404 = streamAiChat({ workspaceId: "ws-999", message: "hi" });
    await expect(gen404.next()).rejects.toThrow("Workspace not found");
  });

  it("throws server error message on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
        json: () => Promise.resolve({ error: "Internal server error" }),
      })
    );

    const gen500 = streamAiChat({ workspaceId: "ws-1", message: "hi" });
    await expect(gen500.next()).rejects.toThrow("Internal server error");
  });
});

// ── useAiHistory ──────────────────────────────────────────────────────────────

describe("useAiHistory — SSR safety + enabled guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not fetch when workspaceId is empty string", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useAiHistory(""), {
      wrapper: makeWrapper(),
    });

    // Should not trigger a fetch with empty workspaceId
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches and returns messages when workspaceId is set", async () => {
    const mockMessages = [
      {
        id: "m1",
        workspaceId: "ws-1",
        userId: "u1",
        role: "user" as const,
        content: "Hello",
        source: null,
        toolCalls: null,
        toolCallId: null,
        createdAt: "2026-10-13T00:00:00Z",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: mockMessages }),
      })
    );

    const { result } = renderHook(() => useAiHistory("ws-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect((result.current.data ?? [])[0]?.content).toBe("Hello");
  });
});
