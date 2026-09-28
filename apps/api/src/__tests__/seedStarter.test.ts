import { describe, it, expect } from "vitest";
import { ensureStarterWorkspace } from "../services/seedStarter.js";
import { mockPrisma } from "./setup.js";

describe("ensureStarterWorkspace", () => {
  it("creates a workspace when user has none", async () => {
    mockPrisma.workspace.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    await ensureStarterWorkspace("user-1");

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("does NOT create a workspace when user already has one", async () => {
    mockPrisma.workspace.count.mockResolvedValue(1);

    await ensureStarterWorkspace("user-1");

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("is idempotent — calling twice does not create two workspaces (F9 acceptance)", async () => {
    // Simulate: first call sees 0 workspaces, creates one; second call sees 1
    mockPrisma.workspace.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    await ensureStarterWorkspace("user-1");
    await ensureStarterWorkspace("user-1");

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("seeds correct tickers in workspace and watchlist", async () => {
    mockPrisma.workspace.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops)
    );
    mockPrisma.workspace.create.mockResolvedValue({});
    mockPrisma.watchlist.create.mockResolvedValue({});

    await ensureStarterWorkspace("user-1");

    const workspaceCreate = mockPrisma.workspace.create.mock.calls[0]?.[0];
    const layout = workspaceCreate?.data?.layout as {
      panels: Array<{ tickers?: string[] }>;
    };
    const chartPanel = layout?.panels?.find((p) => p.tickers);

    expect(workspaceCreate?.data?.name).toBe("Semiconductors");
    expect(chartPanel?.tickers).toEqual(
      expect.arrayContaining(["AVGO", "NVDA", "MRVL", "MU", "VRTS"])
    );

    const watchlistCreate = mockPrisma.watchlist.create.mock.calls[0]?.[0];
    expect(watchlistCreate?.data?.tickers).toEqual(
      expect.arrayContaining(["AVGO", "NVDA", "MRVL", "MU", "VRTS"])
    );
  });
});
