"use client";

import { useCallback, type ReactNode } from "react";
import { X, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PanelWrapperProps {
  panelId: string;
  title: string;
  onRemove: (id: string) => void;
  children: ReactNode;
  className?: string;
}

export function PanelWrapper({
  panelId,
  title,
  onRemove,
  children,
  className,
}: PanelWrapperProps) {
  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(panelId);
    },
    [onRemove, panelId]
  );

  return (
    <div
      className={cn(
        "flex flex-col h-full rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden",
        className
      )}
    >
      {/* Drag handle header */}
      <div className="panel-drag-handle flex items-center gap-2 px-3 py-2 border-b bg-muted/30 cursor-grab active:cursor-grabbing select-none">
        <GripHorizontal className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <span className="text-sm font-medium text-foreground flex-1 truncate">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleRemove}
          aria-label={`Remove ${title} panel`}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}
