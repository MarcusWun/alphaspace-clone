import { apiClient } from "@/lib/api-client";
import type { WorkspaceLayout } from "@alpha/types";

export interface Workspace {
  id: string;
  name: string;
  layout: WorkspaceLayout | null;
  chartType: "line" | "candles";
  updatedAt: string;
  createdAt: string;
}

export interface WorkspaceListResponse {
  data: Workspace[];
}

export interface WorkspaceSingleResponse {
  data: Workspace;
}

// Query keys
export const workspaceKeys = {
  all: ["workspaces"] as const,
  single: (id: string) => ["workspaces", id] as const,
};

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const res = await apiClient.get<WorkspaceListResponse>("/api/workspaces");
  return res.data;
}

export async function fetchWorkspace(id: string): Promise<Workspace> {
  const res = await apiClient.get<WorkspaceSingleResponse>(`/api/workspaces/${id}`);
  return res.data;
}

export async function createWorkspace(name: string, layout?: WorkspaceLayout): Promise<Workspace> {
  const res = await apiClient.post<WorkspaceSingleResponse>("/api/workspaces", {
    name,
    layout,
  });
  return res.data;
}

export async function updateWorkspace(
  id: string,
  updates: { name?: string; layout?: WorkspaceLayout; chartType?: "line" | "candles" }
): Promise<Workspace> {
  const res = await apiClient.put<WorkspaceSingleResponse>(`/api/workspaces/${id}`, updates);
  return res.data;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await apiClient.delete(`/api/workspaces/${id}`);
}
