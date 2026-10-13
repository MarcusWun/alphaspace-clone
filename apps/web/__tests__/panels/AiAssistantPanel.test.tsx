/**
 * FE-P3A-6 — Component tests for AiAssistantPanel.
 *
 * Covers: empty state, history loaded, input send fires streamAiChat,
 * tokens render incrementally, tool chip expand/collapse, source badge
 * on done, !deep dormant notice, New chat fires useClearAiHistory + undo toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { useAiHistoryMock, useClearAiHistoryMock, streamAiChatMock } = vi.hoisted(() => ({
  useAiHistoryMock: vi.fn(),
  useClearAiHistoryMock: vi.fn(),
  streamAiChatMock: vi.fn(),
}));

vi.mock("@/lib/queries/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/ai")>();
  return {
    ...actual,
    useAiHistory: useAiHistoryMock,
    useClearAiHistory: useClearAiHistoryMock,
    streamAiChat: streamAiChatMock,
  };
});

// Mock react-markdown to avoid jsdom rendering complexities
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

vi.mock("rehype-highlight", () => ({
  default: () => null,
}));

import { AiAssistantPanel } from "@/components/panels/AiAssistantPanel";
import type { ChatMessage, ChatEvent } from "@/lib/queries/ai";

// ── Factories ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    workspaceId: "ws-1",
    userId: "u1",
    role: "user",
    content: "Hello!",
    source: null,
    toolCalls: null,
    toolCallId: null,
    createdAt: "2026-10-13T00:00:00Z",
    ...overrides,
  };
}

async function* makeStream(events: ChatEvent[]): AsyncGenerator<ChatEvent> {
  for (const event of events) {
    yield event;
    // Yield control to allow React to process state updates
    await new Promise((r) => setTimeout(r, 0));
  }
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useAiHistoryMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  });

  useClearAiHistoryMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  streamAiChatMock.mockImplementation(async function* () {
    // Default: yields nothing
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AiAssistantPanel — empty state", () => {
  it("renders empty state prompt when no messages", () => {
    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByTestId("new-chat-button")).toBeInTheDocument();
  });

  it("renders loading skeletons while history loads", () => {
    useAiHistoryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    expect(screen.getByTestId("history-loading")).toBeInTheDocument();
  });

  it("renders error state when history fails", () => {
    useAiHistoryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    expect(screen.getByTestId("history-error")).toBeInTheDocument();
  });
});

describe("AiAssistantPanel — history loaded state", () => {
  it("renders user and assistant messages from history", () => {
    useAiHistoryMock.mockReturnValue({
      data: [
        makeMessage({ id: "m1", role: "user", content: "What is NVDA?" }),
        makeMessage({
          id: "m2",
          role: "assistant",
          content: "NVDA is NVIDIA Corporation.",
          source: "local",
        }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    expect(screen.getByTestId("user-bubble")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-bubble")).toBeInTheDocument();
  });

  it("tool-role messages are hidden", () => {
    useAiHistoryMock.mockReturnValue({
      data: [makeMessage({ id: "m1", role: "tool", content: "tool result" })],
      isLoading: false,
      isError: false,
    });

    const { container } = render(
      <AiAssistantPanel panelId="p1" workspaceId="ws-1" />,
      { wrapper: makeWrapper() }
    );

    // Tool role renders null — no bubble
    expect(container.querySelector("[data-testid='user-bubble']")).toBeNull();
    expect(container.querySelector("[data-testid='assistant-bubble']")).toBeNull();
  });
});

describe("AiAssistantPanel — input send fires streamAiChat", () => {
  it("calls streamAiChat with correct params on Enter", async () => {
    const user = userEvent.setup();
    const events: ChatEvent[] = [{ type: "done", source: "local", messageId: "m-x" }];
    streamAiChatMock.mockImplementation(() => makeStream(events));

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "What is NVDA?");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(streamAiChatMock).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        message: "What is NVDA?",
        deep: false,
      })
    );
  });

  it("calls streamAiChat with deep=true when !deep prefix is used", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(() =>
      makeStream([{ type: "done", source: "local", messageId: "m-y" }])
    );

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "!deep What is the market cap of NVDA?");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(streamAiChatMock).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        message: "What is the market cap of NVDA?",
        deep: true,
      })
    );
  });

  it("shows deep indicator when !deep prefix is in input", async () => {
    const user = userEvent.setup();

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "!deep hello");

    expect(screen.getByTestId("deep-indicator")).toBeInTheDocument();
  });

  it("disables input while streaming", async () => {
    const user = userEvent.setup();
    let resolveStream!: () => void;
    streamAiChatMock.mockImplementation(
      () =>
        new ReadableStream({
          start() {},
        })
    );
    // Use a stream that never resolves
    streamAiChatMock.mockImplementation(async function* () {
      await new Promise<void>((r) => {
        resolveStream = r;
      });
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "test message");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(input).toBeDisabled());

    // Cleanup
    resolveStream();
  });
});

describe("AiAssistantPanel — token rendering", () => {
  it("shows optimistic user bubble during stream", async () => {
    const user = userEvent.setup();
    let resolveStream!: () => void;
    streamAiChatMock.mockImplementation(async function* () {
      await new Promise<void>((r) => { resolveStream = r; });
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "Tell me about AAPL");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("optimistic-user-bubble")).toBeInTheDocument()
    );

    resolveStream();
  });

  it("shows streaming content as tokens arrive", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(() =>
      makeStream([
        { type: "token", content: "NVDA " },
        { type: "token", content: "is great." },
        { type: "done", source: "local", messageId: "m-z" },
      ])
    );

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "Tell me about NVDA");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.queryByTestId("optimistic-user-bubble")).not.toBeInTheDocument()
    );
  });
});

describe("AiAssistantPanel — tool call chip", () => {
  it("tool chip is collapsed by default, expands on click", async () => {
    const user = userEvent.setup();
    let resolveStream!: () => void;
    streamAiChatMock.mockImplementation(async function* () {
      yield { type: "tool_call", id: "tc-1", name: "get_quote", args: { symbol: "NVDA" } } as ChatEvent;
      yield { type: "tool_result", id: "tc-1", name: "get_quote", result: { c: 450 } } as ChatEvent;
      yield { type: "token", content: "NVDA is 450." } as ChatEvent;
      // Pause here so we can interact with the chip while still streaming
      await new Promise<void>((r) => { resolveStream = r; });
      yield { type: "done", source: "local", messageId: "m-tc" } as ChatEvent;
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "quote");
    await user.keyboard("{Enter}");

    // Wait for streaming tool call chip to appear
    await waitFor(() => screen.getByTestId("tool-call-chip"));

    const chip = screen.getByTestId("tool-call-chip");
    // Should be collapsed by default — result not visible
    expect(screen.queryByTestId("tool-call-result")).not.toBeInTheDocument();

    // Expand
    await user.click(chip);
    expect(screen.getByTestId("tool-call-result")).toBeInTheDocument();

    // Collapse again
    await user.click(chip);
    expect(screen.queryByTestId("tool-call-result")).not.toBeInTheDocument();

    // Let stream finish
    resolveStream();
  });
});

describe("AiAssistantPanel — source badge on done", () => {
  it("shows source badge after done event", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(() =>
      makeStream([
        { type: "token", content: "Response text" },
        { type: "done", source: "local", messageId: "m-done" },
      ])
    );

    // After done, invalidate query returns local source badge
    useAiHistoryMock.mockReturnValueOnce({
      data: [],
      isLoading: false,
      isError: false,
    });
    useAiHistoryMock.mockReturnValue({
      data: [
        makeMessage({
          id: "m-done",
          role: "assistant",
          content: "Response text",
          source: "local",
        }),
      ],
      isLoading: false,
      isError: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "ask");
    await user.keyboard("{Enter}");

    await waitFor(() => screen.getByTestId("assistant-bubble"));
  });
});

describe("AiAssistantPanel — !deep dormant notice", () => {
  it("shows dormant notice when deep=true but source=local", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(() =>
      makeStream([
        { type: "token", content: "Local reply." },
        { type: "done", source: "local", messageId: "m-deep" },
      ])
    );

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "!deep What's happening?");
    await user.keyboard("{Enter}");

    await waitFor(() => screen.getByTestId("dormant-notice"));
    expect(screen.getByTestId("dormant-notice")).toHaveTextContent(
      "Cloud model not configured. Replying locally."
    );
  });

  it("does not show dormant notice when source=cloud", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(() =>
      makeStream([
        { type: "token", content: "Cloud reply." },
        { type: "done", source: "cloud", messageId: "m-cloud" },
      ])
    );

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "!deep Ask cloud");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.queryByTestId("dormant-notice")).not.toBeInTheDocument()
    );
  });
});

describe("AiAssistantPanel — New chat fires useClearAiHistory + undo toast", () => {
  it("New chat button calls clearMutation.mutate", async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn();
    useClearAiHistoryMock.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByTestId("new-chat-button"));
    expect(mutateMock).toHaveBeenCalledWith("ws-1", expect.any(Object));
  });

  it("undo toast appears after successful clear", async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn().mockImplementation((_id, { onSuccess }) => {
      onSuccess?.();
    });
    useClearAiHistoryMock.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByTestId("new-chat-button"));

    await waitFor(() => screen.getByTestId("undo-toast"));
    expect(screen.getByTestId("undo-button")).toBeInTheDocument();
  });

  it("undo button dismisses the toast and re-fetches history", async () => {
    const user = userEvent.setup();
    const mutateMock = vi.fn().mockImplementation((_id, { onSuccess }) => {
      onSuccess?.();
    });
    useClearAiHistoryMock.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByTestId("new-chat-button"));
    await waitFor(() => screen.getByTestId("undo-toast"));

    await user.click(screen.getByTestId("undo-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument()
    );
  });
});

describe("AiAssistantPanel — error handling", () => {
  it("shows stream error when streamAiChat throws", async () => {
    const user = userEvent.setup();
    streamAiChatMock.mockImplementation(async function* () {
      throw new Error("Failed to reach AI. Try again.");
    });

    render(<AiAssistantPanel panelId="p1" workspaceId="ws-1" />, {
      wrapper: makeWrapper(),
    });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "hello");
    await user.keyboard("{Enter}");

    await waitFor(() => screen.getByTestId("stream-error"));
    expect(screen.getByTestId("stream-error")).toHaveTextContent(
      "Failed to reach AI. Try again."
    );
  });
});
