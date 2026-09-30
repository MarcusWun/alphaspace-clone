/**
 * FE-HOTFIX: DashboardClient error card tests (PRD §3.5)
 * Covers:
 * 1. Error state (500 / query failure) → error card with Retry + Sign Out
 * 2. Retry button calls refetch and re-arms the timeout
 * 3. Timeout path: query stuck in loading for 10s → error card appears
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mock refs ────────────────────────────────────────────────────────
const { mockSignOut, mockFetchWorkspaces } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  mockFetchWorkspaces: vi.fn(),
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signOut: mockSignOut,
}));

// Mock workspaces query module
vi.mock("@/lib/queries/workspaces", () => ({
  workspaceKeys: { all: ["workspaces"] as const },
  fetchWorkspaces: mockFetchWorkspaces,
}));

// Stub heavy sub-components so they don't pull in unrelated deps
vi.mock("@/components/header/AppHeader", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));
vi.mock("@/components/canvas/CanvasShell", () => ({
  CanvasShell: () => <div data-testid="canvas-shell" />,
}));

import { DashboardClient } from "@/components/dashboard/DashboardClient";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockSignOut.mockClear();
  mockFetchWorkspaces.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Error state (500 / query rejection) ───────────────────────────────────

describe("DashboardClient — error state", () => {
  it("shows error card when workspaces query fails", async () => {
    mockFetchWorkspaces.mockRejectedValue(new Error("500 Internal Server Error"));

    render(<DashboardClient />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("workspace-error-card")).toBeInTheDocument();
    });

    expect(screen.getByText("Could not load workspaces")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Something went wrong on our end. Please try again or sign out and back in."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("Retry button re-invokes the workspaces query", async () => {
    // First call rejects, second call resolves with data
    mockFetchWorkspaces
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue([
        {
          id: "ws-1",
          name: "Semiconductors",
          layout: null,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ]);

    render(<DashboardClient />, { wrapper });

    // Wait for error card
    await waitFor(() => {
      expect(screen.getByTestId("workspace-error-card")).toBeInTheDocument();
    });

    expect(mockFetchWorkspaces).toHaveBeenCalledTimes(1);

    // Click Retry
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    // fetchWorkspaces should have been called again
    await waitFor(() => {
      expect(mockFetchWorkspaces).toHaveBeenCalledTimes(2);
    });
  });

  it("Sign Out button calls signOut with callbackUrl", async () => {
    mockFetchWorkspaces.mockRejectedValue(new Error("500"));

    render(<DashboardClient />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("workspace-error-card")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/auth/signin" });
  });
});

// ── 2. Timeout path: 10 s with query stuck in loading ────────────────────────

describe("DashboardClient — timeout path", () => {
  it("shows error card after 10s when query is still loading", async () => {
    // fetchWorkspaces never resolves (simulates a hung request)
    mockFetchWorkspaces.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();

    render(<DashboardClient />, { wrapper });

    // Before timeout: no error card
    expect(screen.queryByTestId("workspace-error-card")).not.toBeInTheDocument();

    // Advance past the 10s timeout
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(screen.getByTestId("workspace-error-card")).toBeInTheDocument();
    expect(screen.getByText("Could not load workspaces")).toBeInTheDocument();
  });

  it("does NOT show error card before 10s while loading", async () => {
    mockFetchWorkspaces.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();

    render(<DashboardClient />, { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });

    expect(screen.queryByTestId("workspace-error-card")).not.toBeInTheDocument();
  });
});
