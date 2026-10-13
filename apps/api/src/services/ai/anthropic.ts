import type { ChatEvent, RouterContext } from "./types.js";
import { anthropicTools, dispatchTool } from "./tools.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = () => process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-6";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
  content_block?: AnthropicContentBlock;
}

function historyToAnthropicMessages(
  history: RouterContext["history"],
  userMessage: string
): Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> {
  const msgs: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [];

  for (const m of history) {
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      msgs.push({ role: "assistant", content: m.content });
    }
    // tool messages are folded into the preceding user message in Anthropic format
  }

  msgs.push({ role: "user", content: userMessage });
  return msgs;
}

export async function* streamAnthropicResponse(ctx: RouterContext): AsyncIterable<ChatEvent> {
  const model = ANTHROPIC_MODEL();
  const messages = historyToAnthropicMessages(ctx.history, ctx.userMessage);

  yield* streamAnthropicLoop(model, messages);
}

async function* streamAnthropicLoop(
  model: string,
  messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }>
): AsyncIterable<ChatEvent> {
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages,
      tools: anthropicTools,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${res.statusText}`);
  }

  if (!res.body) throw new Error("Anthropic returned no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Track tool use blocks
  const toolUseBlocks: Map<number, { id: string; name: string; inputJson: string }> = new Map();
  let accumulatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();

      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(raw) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const idx = event.index ?? 0;
        toolUseBlocks.set(idx, {
          id: event.content_block.id ?? `tool-${idx}`,
          name: event.content_block.name ?? "",
          inputJson: "",
        });
      }

      if (event.type === "content_block_delta") {
        const idx = event.index ?? 0;
        if (event.delta?.type === "text_delta" && event.delta.text) {
          accumulatedText += event.delta.text;
          yield { type: "token", content: event.delta.text };
        }
        if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          const block = toolUseBlocks.get(idx);
          if (block) block.inputJson += event.delta.partial_json;
        }
      }

      if (event.type === "message_delta") {
        // Check stop_reason in delta for tool_use stop
      }

      if (event.type === "message_stop") {
        if (toolUseBlocks.size > 0) {
          const toolResults: AnthropicContentBlock[] = [];

          for (const [, tc] of toolUseBlocks) {
            let args: unknown;
            try {
              args = JSON.parse(tc.inputJson);
            } catch {
              args = {};
            }

            yield { type: "tool_call", id: tc.id, name: tc.name, args };

            const dispatchResult = await dispatchTool(tc.name, args);
            const resultContent = JSON.stringify(
              dispatchResult.ok ? dispatchResult.result : { error: dispatchResult.error }
            );

            yield {
              type: "tool_result",
              id: tc.id,
              name: tc.name,
              result: dispatchResult.ok ? dispatchResult.result : { error: dispatchResult.error },
            };

            toolResults.push({
              type: "tool_result",
              id: tc.id,
              content: resultContent,
            });
          }

          // Append assistant message with tool use, then user message with results
          messages.push({
            role: "assistant",
            content: [
              ...(accumulatedText ? [{ type: "text", text: accumulatedText }] : []),
              ...Array.from(toolUseBlocks.values()).map((tc) => ({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input: (() => {
                  try {
                    return JSON.parse(tc.inputJson) as unknown;
                  } catch {
                    return {};
                  }
                })(),
              })),
            ],
          });

          messages.push({ role: "user", content: toolResults });

          toolUseBlocks.clear();
          accumulatedText = "";

          yield* streamAnthropicLoop(model, messages);
          return;
        }

        const messageId = `cloud-${Date.now()}`;
        yield { type: "done", source: "cloud", messageId };
      }
    }
  }
}
