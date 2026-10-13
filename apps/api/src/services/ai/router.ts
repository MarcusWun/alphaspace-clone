import type { ChatEvent, RouterContext } from "./types.js";
import { isCloudConfigured } from "./cloudConfig.js";
import { streamOllamaResponse } from "./ollama.js";
import { streamAnthropicResponse } from "./anthropic.js";

function estimateTokens(history: RouterContext["history"], userMessage: string): number {
  const historyChars = history.reduce((sum, m) => sum + m.content.length, 0);
  return Math.floor((historyChars + userMessage.length) / 4);
}

export async function* routeChat(ctx: RouterContext): AsyncIterable<ChatEvent> {
  const cloudActive = isCloudConfigured();
  const estimatedTokens = estimateTokens(ctx.history, ctx.userMessage);

  const shouldEscalate = cloudActive && (ctx.deep || estimatedTokens > 96000);

  if (shouldEscalate) {
    try {
      yield* streamAnthropicResponse(ctx);
      return;
    } catch (err) {
      console.warn(
        JSON.stringify({ event: "ai.cloud.escalation.failed", err: String(err) })
      );
    }
  }

  try {
    yield* streamOllamaResponse(ctx);
  } catch (err) {
    if (cloudActive && !shouldEscalate) {
      yield* streamAnthropicResponse(ctx);
      return;
    }
    throw err;
  }
}

export { estimateTokens };
