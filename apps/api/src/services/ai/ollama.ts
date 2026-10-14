import type { ChatEvent, RouterContext } from "./types.js";
import { openAiTools, dispatchTool } from "./tools.js";
import { sanitizeHistory, toOpenAiToolCalls } from "./historyLoader.js";
import type { StoredToolCall } from "./historyLoader.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const OLLAMA_BASE_URL = () => process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const OLLAMA_MODEL = () => process.env["OLLAMA_MODEL"] ?? "qwen3.6:27b";

// Map persisted ChatMessage rows to the OpenAI message shape Ollama expects
function historyToMessages(history: RouterContext["history"]): OllamaMessage[] {
  return history.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId ?? "",
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls) {
      return {
        role: "assistant" as const,
        content: m.content || "",
        tool_calls: toOpenAiToolCalls(m.toolCalls as unknown as StoredToolCall[]),
      };
    }
    return {
      role: m.role as "user" | "assistant",
      content: m.content,
    };
  });
}

interface OllamaToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OllamaMessage =
  | { role: "system"; content: string }
  | { role: "user" | "assistant"; content: string; tool_calls?: OllamaToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface OllamaDelta {
  role?: string;
  content?: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChunk {
  choices?: Array<{
    delta?: OllamaDelta;
    finish_reason?: string | null;
  }>;
}

export async function warmUpOllama(): Promise<{ model: string; ok: boolean; duration_ms: number }> {
  const start = Date.now();
  const model = OLLAMA_MODEL();
  try {
    const res = await fetch(`${OLLAMA_BASE_URL()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama warmup status: ${res.status}`);
    const duration_ms = Date.now() - start;
    return { model, ok: true, duration_ms };
  } catch (err) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(JSON.stringify({ event: "ai.ollama.warmup", model, ok: false, duration_ms, error: message }));
    return { model, ok: false, duration_ms };
  }
}

export async function* streamOllamaResponse(ctx: RouterContext): AsyncIterable<ChatEvent> {
  const model = OLLAMA_MODEL();
  const sanitized = sanitizeHistory(ctx.history, ctx.workspaceId);
  const messages: OllamaMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyToMessages(sanitized),
    { role: "user", content: ctx.userMessage },
  ];

  yield* streamOllamaLoop(model, messages);
}

async function* streamOllamaLoop(
  model: string,
  messages: OllamaMessage[]
): AsyncIterable<ChatEvent> {
  const timeoutMs = parseInt(process.env["OLLAMA_REQUEST_TIMEOUT_MS"] ?? "60000", 10);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: openAiTools,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const duration_ms = Date.now() - started;
    const errObj = err as { name?: string };
    if (errObj.name === "AbortError" || errObj.name === "TimeoutError") {
      console.warn(JSON.stringify({ event: "ai.ollama.timeout", model, duration_ms, timeout_ms: timeoutMs }));
      yield { type: "error", source: "local", message: "Ollama request timed out", code: "ollama_timeout" };
      return;
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${res.statusText}`);
  }

  if (!res.body) throw new Error("Ollama returned no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Accumulate tool calls across chunks (may be fragmented)
  const pendingToolCalls: Map<number, { id: string; name: string; argsJson: string }> = new Map();
  let accumulatedContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;

      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(raw) as OllamaChunk;
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        accumulatedContent += delta.content;
        yield { type: "token", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = parseInt(String(tc.id ?? "0"), 10);
          const existing = pendingToolCalls.get(idx);
          if (existing) {
            existing.argsJson += tc.function?.arguments ?? "";
          } else {
            pendingToolCalls.set(idx, {
              id: tc.id ?? `tool-${idx}`,
              name: tc.function?.name ?? "",
              argsJson: tc.function?.arguments ?? "",
            });
          }
        }
      }

      const finishReason = chunk.choices?.[0]?.finish_reason;
      if (finishReason === "tool_calls" || (finishReason === "stop" && pendingToolCalls.size > 0)) {
        // Dispatch each pending tool call; collect results before mutating messages
        const toolCallMessages: OllamaToolCall[] = [];
        const toolResults: Array<{ toolCallId: string; resultContent: string }> = [];
        for (const [, tc] of pendingToolCalls) {
          let args: unknown;
          try {
            args = JSON.parse(tc.argsJson);
          } catch {
            args = {};
          }

          yield { type: "tool_call", id: tc.id, name: tc.name, args };

          const dispatchResult = await dispatchTool(tc.name, args);
          const resultContent = JSON.stringify(
            dispatchResult.ok ? dispatchResult.result : { error: dispatchResult.error }
          );

          yield { type: "tool_result", id: tc.id, name: tc.name, result: dispatchResult.ok ? dispatchResult.result : { error: dispatchResult.error } };

          toolCallMessages.push({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.argsJson },
          });

          toolResults.push({ toolCallId: tc.id, resultContent });
        }

        // OpenAI protocol: assistant(tool_calls) MUST precede all tool-role messages
        messages.push({
          role: "assistant",
          content: accumulatedContent,
          tool_calls: toolCallMessages,
        });
        for (const { toolCallId, resultContent } of toolResults) {
          messages.push({ role: "tool", tool_call_id: toolCallId, content: resultContent });
        }

        pendingToolCalls.clear();
        accumulatedContent = "";

        // Continue the conversation after tool results
        yield* streamOllamaLoop(model, messages);
        return;
      }
    }
  }

  // Emit done with a synthetic messageId
  const messageId = `local-${Date.now()}`;
  yield { type: "done", source: "local", messageId };
}
