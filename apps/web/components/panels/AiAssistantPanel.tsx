"use client";

/**
 * FE-P3A-4 — AI Assistant panel (PRD §3.1 + §5.3, P6).
 *
 * No client-side message persistence — all persistence is backend.
 * Local state is transient (streaming bubble + optimistic user bubble).
 *
 * NB-1 carry-forward: history reappears after 30s undo window if no new POST
 * overwrites. Do NOT work around this — pass backend behavior through.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAiHistory,
  useClearAiHistory,
  streamAiChat,
  aiKeys,
  type ChatMessage,
} from "@/lib/queries/ai";
import { MessageBubble, TransientAssistantBubble } from "./ai/MessageBubble";
import { ChatInput } from "./ai/ChatInput";
import { Skeleton } from "@/components/ui/skeleton";

interface ToolCallState {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
}

interface AiAssistantPanelProps {
  panelId: string;
  workspaceId: string;
}

const UNDO_WINDOW_MS = 30_000;

export function AiAssistantPanel({ panelId, workspaceId }: AiAssistantPanelProps) {
  const queryClient = useQueryClient();

  const {
    data: historyMessages,
    isLoading: historyLoading,
    isError: historyError,
  } = useAiHistory(workspaceId);

  const clearMutation = useClearAiHistory();

  // ── Transient streaming state ─────────────────────────────────────────────
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallState[]>([]);
  const [streamingSource, setStreamingSource] = useState<"local" | "cloud" | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [dormantNotice, setDormantNotice] = useState(false);

  // ── "New chat" undo toast ─────────────────────────────────────────────────
  const [undoPending, setUndoPending] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scroll anchor ─────────────────────────────────────────────────────────
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    scrollToBottom();
  }, [historyMessages, streamingContent, isStreaming]);

  // Abort signal for cleanup on unmount
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // ── New chat ──────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    clearMutation.mutate(workspaceId, {
      onSuccess: () => {
        setUndoPending(true);
        setDormantNotice(false);
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
          setUndoPending(false);
        }, UNDO_WINDOW_MS);
      },
    });
  }, [clearMutation, workspaceId]);

  const handleUndo = useCallback(() => {
    // Cancel the undo timer — history will reappear when the 30s Redis sentinel
    // expires (NB-1). Just re-fetch to show current state.
    setUndoPending(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    queryClient.invalidateQueries({ queryKey: aiKeys.history(workspaceId) });
  }, [queryClient, workspaceId]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (message: string, deep: boolean) => {
      if (isStreaming) return;

      setStreamError(null);
      setDormantNotice(false);
      setOptimisticUserMsg(message);
      setStreamingContent("");
      setStreamingToolCalls([]);
      setStreamingSource(undefined);
      setIsStreaming(true);
      setUndoPending(false);

      abortRef.current = new AbortController();

      try {
        for await (const event of streamAiChat({ workspaceId, message, deep })) {
          if (abortRef.current?.signal.aborted) break;

          if (event.type === "token") {
            setStreamingContent((prev) => prev + event.content);
          } else if (event.type === "tool_call") {
            setStreamingToolCalls((prev) => [
              ...prev,
              { id: event.id, name: event.name, args: event.args },
            ]);
          } else if (event.type === "tool_result") {
            setStreamingToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === event.id ? { ...tc, result: event.result } : tc
              )
            );
          } else if (event.type === "heartbeat") {
            // keep-alive — no UI change
          } else if (event.type === "done") {
            setStreamingSource(event.source);
            if (deep && event.source === "local") {
              setDormantNotice(true);
            }
            // Invalidate history to load persisted messages
            await queryClient.invalidateQueries({
              queryKey: aiKeys.history(workspaceId),
            });
          }
        }
      } catch (err) {
        if (!abortRef.current?.signal.aborted) {
          setStreamError(
            err instanceof Error ? err.message : "Failed to reach AI. Try again."
          );
        }
      } finally {
        setOptimisticUserMsg(null);
        setStreamingContent("");
        setStreamingToolCalls([]);
        setStreamingSource(undefined);
        setIsStreaming(false);
      }
    },
    [isStreaming, workspaceId, queryClient]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const messages: ChatMessage[] = historyMessages ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden" data-panel-id={panelId}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
            AI Assistant
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          disabled={isStreaming || clearMutation.isPending}
          className="h-7 text-xs shrink-0"
          data-testid="new-chat-button"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 mr-1" />
          New chat
        </Button>
      </div>

      {/* Undo toast (inline) */}
      {undoPending && (
        <div
          className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border/40 shrink-0 text-xs"
          data-testid="undo-toast"
        >
          <span className="text-muted-foreground">Chat cleared</span>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 text-primary hover:text-primary/80 font-medium"
            data-testid="undo-button"
          >
            <RotateCcw className="h-3 w-3" />
            Undo
          </button>
        </div>
      )}

      {/* Message list */}
      <div
        ref={messageListRef}
        className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-3 min-h-0"
        data-testid="message-list"
      >
        {historyLoading && (
          <div className="flex flex-col gap-2" data-testid="history-loading">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-12 w-5/6" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}

        {historyError && !historyLoading && (
          <div className="text-xs text-destructive" data-testid="history-error">
            Failed to load chat history.
          </div>
        )}

        {!historyLoading && messages.length === 0 && !isStreaming && !optimisticUserMsg && (
          <div
            className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground"
            data-testid="empty-state"
          >
            <p className="text-xs text-center">
              Ask me about any stock, market data, or company fundamentals.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Optimistic user message (before history refresh) */}
        {optimisticUserMsg && (
          <div className="flex justify-end" data-testid="optimistic-user-bubble">
            <div className="max-w-[85%] bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-sm">
              {optimisticUserMsg}
            </div>
          </div>
        )}

        {/* Streaming assistant bubble */}
        {isStreaming && (
          <TransientAssistantBubble
            content={streamingContent}
            source={streamingSource}
            toolCalls={streamingToolCalls}
            isDone={false}
          />
        )}

        {/* Scroll anchor */}
        <div ref={scrollAnchorRef} />
      </div>

      {/* Error display */}
      {streamError && (
        <div
          className="px-3 py-1.5 text-xs text-destructive border-t border-border/40 bg-destructive/5 shrink-0"
          data-testid="stream-error"
        >
          {streamError}
        </div>
      )}

      {/* Dormant cloud notice */}
      {dormantNotice && !isStreaming && (
        <div
          className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border/40 bg-muted/20 shrink-0"
          data-testid="dormant-notice"
        >
          Cloud model not configured. Replying locally.
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-1 shrink-0">
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
