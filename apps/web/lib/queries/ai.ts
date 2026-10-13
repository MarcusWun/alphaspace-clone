/**
 * FE-P3A-2 — AI Assistant query hooks + SSE stream reader.
 * Types are frontend-only mirrors of the backend CONTRACTS.md shapes.
 * Do NOT import from packages/types — these are AI-specific and not shared.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types (mirror of backend CONTRACTS.md § AI Assistant) ────────────────────

export interface ChatMessage {
  id: string;
  workspaceId: string;
  userId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  source: "local" | "cloud" | null;
  toolCalls: unknown[] | null;
  toolCallId: string | null;
  createdAt: string;
}

export type ChatEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "heartbeat" }
  | { type: "done"; source: "local" | "cloud"; messageId: string };

// ── Query keys ─────────────────────────────────────────────────────────────────

export const aiKeys = {
  history: (workspaceId: string) => ["ai.history", workspaceId] as const,
};

// ── Hooks ──────────────────────────────────────────────────────────────────────

export function useAiHistory(workspaceId: string) {
  return useQuery({
    queryKey: aiKeys.history(workspaceId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const res = await fetch(`/api/ai/history/${encodeURIComponent(workspaceId)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthenticated");
        if (res.status === 404) throw new Error("Workspace not found");
        throw new Error(`Failed to load history: ${res.status}`);
      }
      const body = (await res.json()) as { messages: ChatMessage[] };
      return body.messages;
    },
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useClearAiHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: string): Promise<void> => {
      const res = await fetch(`/api/ai/history/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthenticated");
        if (res.status === 404) throw new Error("Workspace not found");
        throw new Error(`Failed to clear history: ${res.status}`);
      }
    },
    onSuccess: (_data, workspaceId) => {
      queryClient.invalidateQueries({ queryKey: aiKeys.history(workspaceId) });
    },
  });
}

// ── SSE stream reader ─────────────────────────────────────────────────────────

export interface StreamAiChatParams {
  workspaceId: string;
  message: string;
  deep?: boolean;
}

/**
 * Async generator that streams chat events from POST /api/ai/chat/stream.
 *
 * Handles:
 * - Partial chunks (event split across multiple reads)
 * - Multiple events in a single read
 * - Heartbeat events (yields as-is; callers should ignore them)
 * - Non-200 errors (throws with a descriptive message)
 * - done event terminates iteration
 */
export async function* streamAiChat(
  params: StreamAiChatParams
): AsyncGenerator<ChatEvent> {
  const { workspaceId, message, deep = false } = params;

  const res = await fetch("/api/ai/chat/stream", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, message, deep }),
  });

  if (!res.ok) {
    let errorMsg = `Server error: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch {
      // ignore JSON parse failure
    }
    if (res.status === 401) throw new Error("Unauthenticated");
    if (res.status === 404) throw new Error("Workspace not found");
    throw new Error(errorMsg);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete SSE events (delimited by \n\n)
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const line = rawEvent.trim();
        if (!line.startsWith("data: ")) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        const payload = line.slice(6); // strip "data: "
        let event: ChatEvent;
        try {
          event = JSON.parse(payload) as ChatEvent;
        } catch {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        yield event;

        if (event.type === "done") {
          return;
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
