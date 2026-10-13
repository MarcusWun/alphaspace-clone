import type { ChatMessage } from "@alpha/db";

export type { ChatMessage };

export type ChatRole = "user" | "assistant" | "tool";

export type ChatEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "heartbeat" }
  | { type: "done"; source: "local" | "cloud"; messageId: string }
  | { type: "error"; source: "local" | "cloud"; message: string; code: string };

export interface RouterContext {
  userId: string;
  workspaceId: string;
  history: ChatMessage[];
  userMessage: string;
  deep: boolean;
}
