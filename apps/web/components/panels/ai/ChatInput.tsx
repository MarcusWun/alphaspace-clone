"use client";

import { useState, useRef } from "react";
import { Send, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string, deep: boolean) => void;
  disabled?: boolean;
}

// Detects !deep prefix (case-insensitive, with optional trailing whitespace)
const DEEP_RE = /^!deep\s*/i;

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDeep = DEEP_RE.test(value);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    const deep = DEEP_RE.test(trimmed);
    const message = trimmed.replace(DEEP_RE, "").trim();
    if (!message) return;
    onSend(message, deep);
    setValue("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-1 shrink-0 pt-1 border-t border-border/40">
      {isDeep && (
        <div
          className="text-xs text-blue-400/80 flex items-center gap-1 px-1"
          data-testid="deep-indicator"
        >
          <Zap className="h-3 w-3" />
          Cloud model requested
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Waiting for response…" : "Ask anything… (Enter to send, Shift+Enter for newline)"}
          disabled={disabled}
          rows={2}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2",
            "text-sm placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "min-h-[60px] max-h-[160px]"
          )}
          data-testid="chat-input"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={disabled || !value.trim().replace(DEEP_RE, "").trim()}
          data-testid="send-button"
          className="shrink-0 h-9"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
