import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeChat } from "../../services/ai/router.js";
import type { RouterContext } from "../../services/ai/types.js";

vi.mock("../../services/ai/cloudConfig.js", () => ({
  isCloudConfigured: vi.fn(),
}));

vi.mock("../../services/ai/ollama.js", () => ({
  streamOllamaResponse: vi.fn(),
  warmUpOllama: vi.fn(),
}));

vi.mock("../../services/ai/anthropic.js", () => ({
  streamAnthropicResponse: vi.fn(),
}));

import { isCloudConfigured } from "../../services/ai/cloudConfig.js";
import { streamOllamaResponse } from "../../services/ai/ollama.js";
import { streamAnthropicResponse } from "../../services/ai/anthropic.js";

const mockCloudConfigured = vi.mocked(isCloudConfigured);
const mockOllama = vi.mocked(streamOllamaResponse);
const mockAnthropic = vi.mocked(streamAnthropicResponse);

async function* makeLocalStream(): AsyncIterable<{ type: "done"; source: "local"; messageId: string }> {
  yield { type: "done", source: "local", messageId: "m1" };
}

async function* makeCloudStream(): AsyncIterable<{ type: "done"; source: "cloud"; messageId: string }> {
  yield { type: "done", source: "cloud", messageId: "m2" };
}

function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    userId: "user-1",
    workspaceId: "ws-1",
    history: [],
    userMessage: "hello",
    deep: false,
    ...overrides,
  };
}

async function collectEvents(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routeChat", () => {
  it("(a) cloud dormant + deep=true → routes to ollama only (no anthropic call)", async () => {
    mockCloudConfigured.mockReturnValue(false);
    mockOllama.mockReturnValue(makeLocalStream());

    const events = await collectEvents(routeChat(makeCtx({ deep: true })));

    expect(mockOllama).toHaveBeenCalledTimes(1);
    expect(mockAnthropic).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "done", source: "local", messageId: "m1" });
  });

  it("(b) cloud active + deep=true → routes to anthropic", async () => {
    mockCloudConfigured.mockReturnValue(true);
    mockAnthropic.mockReturnValue(makeCloudStream());

    const events = await collectEvents(routeChat(makeCtx({ deep: true })));

    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(mockOllama).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "done", source: "cloud", messageId: "m2" });
  });

  it("(c) cloud active + tokens > 96000 → routes to anthropic", async () => {
    mockCloudConfigured.mockReturnValue(true);
    mockAnthropic.mockReturnValue(makeCloudStream());

    // Create a very long message to exceed the 96k token threshold
    const longMessage = "x".repeat(96000 * 4 + 100);
    const events = await collectEvents(routeChat(makeCtx({ userMessage: longMessage })));

    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(mockOllama).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "done", source: "cloud", messageId: "m2" });
  });

  it("(d) cloud active + ollama throws → anthropic fallback invoked", async () => {
    mockCloudConfigured.mockReturnValue(true);
    mockOllama.mockImplementation(async function* () {
      throw new Error("ollama failed");
    });
    mockAnthropic.mockReturnValue(makeCloudStream());

    const events = await collectEvents(routeChat(makeCtx()));

    expect(mockOllama).toHaveBeenCalledTimes(1);
    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "done", source: "cloud", messageId: "m2" });
  });

  it("(e) cloud dormant + ollama throws → router throws (no anthropic call)", async () => {
    mockCloudConfigured.mockReturnValue(false);
    mockOllama.mockImplementation(async function* () {
      throw new Error("ollama failed");
    });

    await expect(collectEvents(routeChat(makeCtx()))).rejects.toThrow("ollama failed");
    expect(mockAnthropic).not.toHaveBeenCalled();
  });

  it("(f) cloud active + anthropic throws on escalation → falls through to ollama", async () => {
    mockCloudConfigured.mockReturnValue(true);
    mockAnthropic.mockImplementation(async function* () {
      throw new Error("anthropic failed");
    });
    mockOllama.mockReturnValue(makeLocalStream());

    // deep=true triggers escalation path; anthropic fails, falls through to ollama
    const events = await collectEvents(routeChat(makeCtx({ deep: true })));

    expect(mockAnthropic).toHaveBeenCalledTimes(1);
    expect(mockOllama).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "done", source: "local", messageId: "m1" });
  });

  it("(g) !deep + cloud dormant → ollama + source:local on done event", async () => {
    mockCloudConfigured.mockReturnValue(false);
    mockOllama.mockReturnValue(makeLocalStream());

    const events = await collectEvents(routeChat(makeCtx({ deep: false })));

    expect(mockOllama).toHaveBeenCalledTimes(1);
    expect(mockAnthropic).not.toHaveBeenCalled();
    const done = events.find((e) => (e as { type: string }).type === "done");
    expect((done as { source: string }).source).toBe("local");
  });
});
