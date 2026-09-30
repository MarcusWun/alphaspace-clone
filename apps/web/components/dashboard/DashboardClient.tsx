"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { AppHeader } from "@/components/header/AppHeader";
import { CanvasShell } from "@/components/canvas/CanvasShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchWorkspaces,
  updateWorkspace,
  workspaceKeys,
  type Workspace,
} from "@/lib/queries/workspaces";
import type { WorkspaceLayout } from "@alpha/types";

const WORKSPACE_LOAD_TIMEOUT_MS = 10_000;

/**
 * DashboardClient handles:
 * - Loading workspaces (triggers F9 seed on first login via backend side effect)
 * - Workspace switching
 * - Debounced layout autosave to PUT /api/workspaces/:id
 * - Passing last-saved timestamp to AppHeader
 */
export function DashboardClient() {
  const queryClient = useQueryClient();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // GET /api/workspaces — triggers seed if zero workspaces (F9)
  const { data: workspaces, isLoading, isError, refetch } = useQuery({
    queryKey: workspaceKeys.all,
    queryFn: fetchWorkspaces,
    staleTime: 0,
    retry: false,
  });

  // 10-second hard timeout: if still loading after 10s, show the error card
  useEffect(() => {
    if (isLoading) {
      setTimedOut(false);
      loadTimerRef.current = setTimeout(() => {
        setTimedOut(true);
      }, WORKSPACE_LOAD_TIMEOUT_MS);
    } else {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    }
    return () => {
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    };
  }, [isLoading]);

  const handleRetry = useCallback(() => {
    setTimedOut(false);
    refetch();
  }, [refetch]);

  // Resolve active workspace (most-recently-updated on first load)
  const resolvedId = (() => {
    if (!workspaces?.length) return null;
    if (activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId)) {
      return activeWorkspaceId;
    }
    // Land on most-recently-updated workspace (F9)
    const sorted = [...workspaces].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return sorted[0]?.id ?? null;
  })();

  const activeWorkspace = workspaces?.find((w) => w.id === resolvedId) ?? null;

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      layout,
    }: {
      id: string;
      layout: WorkspaceLayout;
    }) => updateWorkspace(id, { layout }),
    onSuccess: () => {
      setLastSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });

  const handleLayoutChange = useCallback(
    (layout: WorkspaceLayout) => {
      if (!resolvedId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveMutation.mutate({ id: resolvedId, layout });
      }, 300);
    },
    [resolvedId, saveMutation]
  );

  const handleWorkspaceChange = useCallback((ws: Workspace) => {
    setActiveWorkspaceId(ws.id);
  }, []);

  if (isError || timedOut) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md mx-4" data-testid="workspace-error-card">
          <CardHeader>
            <CardTitle>Could not load workspaces</CardTitle>
            <CardDescription>
              Something went wrong on our end. Please try again or sign out and back in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button onClick={handleRetry}>Retry</Button>
            <Button
              variant="outline"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-muted-foreground text-sm">
        Loading Alpha…
      </div>
    );
  }

  if (!workspaces?.length) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-muted-foreground text-sm">
        Setting up your workspace…
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader
        activeWorkspaceId={resolvedId}
        lastSavedAt={lastSavedAt}
        onWorkspaceChange={handleWorkspaceChange}
      />
      {activeWorkspace && (
        <div className="flex-1 overflow-hidden">
          <CanvasShell
            key={activeWorkspace.id}
            workspaceId={activeWorkspace.id}
            initialLayout={activeWorkspace.layout}
            onLayoutChange={handleLayoutChange}
          />
        </div>
      )}
    </div>
  );
}
