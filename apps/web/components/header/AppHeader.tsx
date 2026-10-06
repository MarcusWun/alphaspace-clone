"use client";

import { useState, useRef } from "react";
import { signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus, Trash2, ChevronDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchWorkspaces,
  createWorkspace,
  deleteWorkspace,
  updateWorkspace,
  workspaceKeys,
  type Workspace,
} from "@/lib/queries/workspaces";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  activeWorkspaceId: string | null;
  lastSavedAt: Date | null;
  onWorkspaceChange: (workspace: Workspace) => void;
  /** Current workspace chart type — drives the Line / Candles toggle */
  chartType: "line" | "candles";
  /** Called optimistically on toggle; parent rolls back on mutation error */
  onChartTypeChange: (ct: "line" | "candles") => void;
  /** When true, Candles option shows aria-disabled + tooltip */
  candlesDisabled?: boolean;
}

export function AppHeader({
  activeWorkspaceId,
  lastSavedAt,
  onWorkspaceChange,
  chartType,
  onChartTypeChange,
  candlesDisabled = false,
}: AppHeaderProps) {
  const queryClient = useQueryClient();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: workspaces } = useQuery({
    queryKey: workspaceKeys.all,
    queryFn: fetchWorkspaces,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createWorkspace(name),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      onWorkspaceChange(workspace);
      setCreating(false);
      setNewName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      if (deletedId === activeWorkspaceId && workspaces) {
        const remaining = workspaces.filter((w) => w.id !== deletedId);
        if (remaining[0]) onWorkspaceChange(remaining[0]);
      }
    },
  });

  // previousChartTypeRef captures the optimistic pre-mutation value so onError can roll back.
  const previousChartTypeRef = useRef<"line" | "candles">("line");

  const chartTypeMutation = useMutation({
    mutationFn: (ct: "line" | "candles") =>
      updateWorkspace(activeWorkspaceId!, { chartType: ct }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
    onError: () => {
      // Roll back to the pre-mutation value
      onChartTypeChange(previousChartTypeRef.current);
    },
  });

  const handleChartTypeChange = (ct: "line" | "candles") => {
    if (ct === chartType) return;
    if (!activeWorkspaceId) return;
    previousChartTypeRef.current = chartType; // capture before optimistic update
    onChartTypeChange(ct); // optimistic update
    chartTypeMutation.mutate(ct);
  };

  const activeWorkspace = workspaces?.find((w) => w.id === activeWorkspaceId);

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0 z-10">
      {/* Brand */}
      <div className="flex items-center gap-4">
        <span className="text-base font-bold tracking-tight text-foreground">
          Alpha
        </span>

        {/* Workspace switcher */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 font-medium"
            onClick={() => setDropdownOpen((o) => !o)}
          >
            <span className="max-w-[160px] truncate">
              {activeWorkspace?.name ?? "Select workspace"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </Button>

          {dropdownOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute left-0 top-full mt-1 w-64 rounded-lg border bg-popover shadow-md z-20 py-1">
                {workspaces?.map((ws) => (
                  <div
                    key={ws.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent group",
                      ws.id === activeWorkspaceId && "bg-accent/50 font-medium"
                    )}
                    onClick={() => {
                      onWorkspaceChange(ws);
                      setDropdownOpen(false);
                    }}
                  >
                    <span className="truncate flex-1">{ws.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete workspace "${ws.name}"?`)) {
                          deleteMutation.mutate(ws.id);
                        }
                        setDropdownOpen(false);
                      }}
                      aria-label={`Delete ${ws.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}

                <div className="border-t mt-1 pt-1 px-3 py-2">
                  {creating ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (newName.trim()) {
                          createMutation.mutate(newName.trim());
                        }
                      }}
                      className="flex gap-2"
                    >
                      <input
                        autoFocus
                        type="text"
                        placeholder="Workspace name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="flex-1 text-sm border rounded px-2 py-1 bg-background"
                        maxLength={60}
                      />
                      <Button type="submit" size="sm" className="h-7">
                        Add
                      </Button>
                    </form>
                  ) : (
                    <button
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full"
                      onClick={() => setCreating(true)}
                    >
                      <Plus className="h-3 w-3" />
                      New workspace
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Line / Candles segmented control */}
        {activeWorkspaceId && (
          <div
            className="flex items-center rounded-md border border-input overflow-hidden"
            role="group"
            aria-label="Chart type"
          >
            <button
              type="button"
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                chartType === "line"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              onClick={() => handleChartTypeChange("line")}
              aria-pressed={chartType === "line"}
            >
              Line
            </button>
            <button
              type="button"
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                chartType === "candles" && !candlesDisabled
                  ? "bg-primary text-primary-foreground"
                  : candlesDisabled
                  ? "bg-background text-muted-foreground/40 cursor-default"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              onClick={() => !candlesDisabled && handleChartTypeChange("candles")}
              aria-pressed={chartType === "candles" && !candlesDisabled}
              aria-disabled={candlesDisabled || undefined}
              title={
                candlesDisabled
                  ? "Candles only available for single-ticker charts"
                  : undefined
              }
              data-testid="chart-type-candles-btn"
            >
              Candles
            </button>
          </div>
        )}

        {/* Last saved indicator */}
        {lastSavedAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              Saved{" "}
              {lastSavedAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
