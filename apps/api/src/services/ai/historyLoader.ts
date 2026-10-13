import type { ChatMessage } from "@alpha/db";

interface ToolCallEntry {
  id: string;
  [key: string]: unknown;
}

interface SanitizeLogger {
  info?: (obj: unknown, msg?: string) => void;
}

export function sanitizeHistory(
  rows: ChatMessage[],
  workspaceId: string,
  logger?: SanitizeLogger
): ChatMessage[] {
  const out: ChatMessage[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i]!;

    if (row.role === "assistant" && row.toolCalls !== null) {
      const expectedToolIds = (row.toolCalls as unknown as ToolCallEntry[]).map((tc) => tc.id);
      const toolRows: ChatMessage[] = [];
      let j = i + 1;
      let collectedBeforeMismatch = 0;
      let matched = true;

      for (const expectedId of expectedToolIds) {
        if (j < rows.length && rows[j]!.role === "tool" && rows[j]!.toolCallId === expectedId) {
          toolRows.push(rows[j]!);
          j++;
          collectedBeforeMismatch++;
        } else {
          toolRows.length = 0;
          matched = false;
          break;
        }
      }

      if (matched) {
        out.push(row, ...toolRows);
        i = j;
        continue;
      }

      const logPayload = {
        event: "ai.history.sanitized",
        workspaceId,
        orphaned_assistant_rows: 1,
        orphaned_tool_rows: collectedBeforeMismatch,
      };
      if (logger?.info) {
        logger.info(logPayload);
      } else {
        console.info(JSON.stringify(logPayload));
      }

      // Skip the orphaned assistant row and any rows until the next user row
      while (i < rows.length && rows[i]!.role !== "user") {
        i++;
      }
      continue;
    }

    out.push(row);
    i++;
  }

  return out;
}
