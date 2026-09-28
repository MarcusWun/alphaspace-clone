/**
 * Starter workspace seed (F9)
 *
 * Creates a pre-populated "Semiconductors" workspace for new users.
 * Called lazily on first GET /api/workspaces if the user has zero workspaces.
 * Idempotent — only creates if user has zero workspaces.
 *
 * Contents:
 *   - Group Comparison Chart panel with tickers [AVGO, NVDA, MRVL, MU, VRTS], range 1Y
 *   - Watchlist with the same tickers
 *   - News Feed with activeTicker=NVDA
 */

import { prisma } from "@alpha/db";
import type { Prisma } from "@alpha/db";
import type { WorkspaceLayout } from "@alpha/types";
import { randomUUID } from "crypto";

const SEMICONDUCTOR_TICKERS = ["AVGO", "NVDA", "MRVL", "MU", "VRTS"];

export async function ensureStarterWorkspace(userId: string): Promise<void> {
  const count = await prisma.workspace.count({ where: { userId } });
  if (count > 0) return;

  await createSemiconductorsWorkspace(userId);
}

async function createSemiconductorsWorkspace(userId: string): Promise<void> {
  const chartPanelId = randomUUID();
  const watchlistPanelId = randomUUID();
  const newsFeedPanelId = randomUUID();

  const layout: WorkspaceLayout = {
    panels: [
      {
        id: chartPanelId,
        type: "comparison_chart",
        title: "Semiconductor Performance",
        tickers: SEMICONDUCTOR_TICKERS,
        timeRange: "1Y",
      },
      {
        id: watchlistPanelId,
        type: "watchlist",
        title: "Semiconductors Watchlist",
        tickers: SEMICONDUCTOR_TICKERS,
      },
      {
        id: newsFeedPanelId,
        type: "news_feed",
        title: "News",
        activeTicker: "NVDA",
      },
    ],
    grid: [
      { i: chartPanelId, x: 0, y: 0, w: 8, h: 6 },
      { i: watchlistPanelId, x: 8, y: 0, w: 4, h: 6 },
      { i: newsFeedPanelId, x: 0, y: 6, w: 12, h: 4 },
    ],
  };

  await prisma.$transaction([
    prisma.workspace.create({
      data: {
        userId,
        name: "Semiconductors",
        layout: layout as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.watchlist.create({
      data: {
        userId,
        name: "Semiconductors",
        tickers: SEMICONDUCTOR_TICKERS,
      },
    }),
  ]);
}
