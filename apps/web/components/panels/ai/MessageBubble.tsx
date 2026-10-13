"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { AiSourceBadge } from "@/components/ui/ai-source-badge";
import { ToolCallChip } from "./ToolCallChip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/queries/ai";

interface ToolCallState {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
}

/** Persisted history message */
interface MessageBubbleProps {
  message: ChatMessage;
}

/** Transient streaming assistant bubble (not yet persisted) */
interface TransientBubbleProps {
  content: string;
  source?: "local" | "cloud";
  toolCalls: ToolCallState[];
  isDone: boolean;
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="user-bubble">
      <div className="max-w-[85%] bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-sm">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  source,
  toolCalls,
  isDone,
}: {
  content: string;
  source?: "local" | "cloud";
  toolCalls: ToolCallState[];
  isDone: boolean;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="assistant-bubble">
      {/* Tool call chips */}
      {toolCalls.map((tc) => (
        <ToolCallChip
          key={tc.id}
          id={tc.id}
          name={tc.name}
          args={tc.args}
          result={tc.result}
        />
      ))}
      {/* Content */}
      <div className="max-w-[95%]">
        <div
          className={cn(
            "prose prose-sm prose-invert max-w-none text-sm",
            "prose-code:bg-muted/50 prose-code:text-xs prose-code:rounded prose-code:px-1",
            "prose-pre:bg-muted/30 prose-pre:text-xs prose-pre:rounded prose-pre:p-2 prose-pre:overflow-x-auto"
          )}
          data-testid="assistant-content"
        >
          <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
            {content}
          </ReactMarkdown>
        </div>
        {isDone && source && (
          <div className="mt-1 flex justify-start">
            <AiSourceBadge source={source} data-testid="source-badge" />
          </div>
        )}
        {!isDone && (
          <span
            className="inline-block w-1 h-3.5 bg-primary/70 ml-0.5 animate-pulse align-bottom"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return <UserBubble content={message.content} />;
  }

  if (message.role === "tool") {
    // Tool messages are hidden; surfaced via ToolCallChip on the preceding assistant message
    return null;
  }

  // assistant
  const persistedToolCalls: ToolCallState[] = Array.isArray(message.toolCalls)
    ? (message.toolCalls as ToolCallState[])
    : [];

  return (
    <AssistantBubble
      content={message.content}
      source={message.source ?? undefined}
      toolCalls={persistedToolCalls}
      isDone
    />
  );
}

export function TransientAssistantBubble({
  content,
  source,
  toolCalls,
  isDone,
}: TransientBubbleProps) {
  return (
    <AssistantBubble
      content={content}
      source={source}
      toolCalls={toolCalls}
      isDone={isDone}
    />
  );
}
