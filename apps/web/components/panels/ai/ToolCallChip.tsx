"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolCallChipProps {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return String(args ?? "");
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

export function ToolCallChip({ name, args, result }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);
  const argSummary = summarizeArgs(args);

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded",
          "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
          "border border-border/50 transition-colors"
        )}
        data-testid="tool-call-chip"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>
          → {name}({argSummary})
        </span>
      </button>
      {expanded && (
        <div
          className="mt-1 ml-4 text-xs font-mono bg-muted/30 border border-border/40 rounded px-2 py-1 overflow-x-auto"
          data-testid="tool-call-result"
        >
          {result !== undefined ? (
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <span className="text-muted-foreground italic">waiting for result…</span>
          )}
        </div>
      )}
    </div>
  );
}
