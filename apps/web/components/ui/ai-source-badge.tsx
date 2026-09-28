/**
 * AI response source badge — stub for Phase 3.
 * Phase 3 wires this to the AI Assistant panel's response stream.
 * No logic here yet; component exists for the import path.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AiSourceBadgeProps {
  source: "local" | "cloud";
  className?: string;
}

export function AiSourceBadge({ source, className }: AiSourceBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs px-1.5 py-0",
        source === "local"
          ? "border-green-500/50 text-green-500"
          : "border-blue-500/50 text-blue-500",
        className
      )}
    >
      {source === "local" ? "local" : "cloud"}
    </Badge>
  );
}
