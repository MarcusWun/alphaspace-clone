/**
 * Workspace CRUD routes
 *
 * All routes are scoped to req.user.id — no cross-user access.
 * Layout JSONB is validated on write; unknown panel IDs are silently dropped on restore.
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@alpha/db";
import type { Prisma } from "@alpha/db";
import type { WorkspaceLayout, PanelConfig, LayoutItem } from "@alpha/types";
import { ensureStarterWorkspace } from "../services/seedStarter.js";

const LAYOUT_SCHEMA = {
  type: "object",
  properties: {
    panels: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type"],
        properties: {
          id: { type: "string" },
          type: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    grid: {
      type: "array",
      items: {
        type: "object",
        required: ["i", "x", "y", "w", "h"],
        properties: {
          i: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
        additionalProperties: true,
      },
    },
  },
} as const;

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/workspaces — list all workspaces for the current user
  fastify.get("/workspaces", async (request, reply) => {
    // Lazy seed: create starter workspace if user has none
    await ensureStarterWorkspace(request.user.id);

    const workspaces = await prisma.workspace.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ data: workspaces });
  });

  // POST /api/workspaces
  fastify.post<{
    Body: { name: string; layout?: WorkspaceLayout };
  }>(
    "/workspaces",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            layout: LAYOUT_SCHEMA,
          },
        },
      },
    },
    async (request, reply) => {
      const { name, layout } = request.body;
      const workspace = await prisma.workspace.create({
        data: {
          userId: request.user.id,
          name,
          layout: (layout ? sanitizeLayout(layout) : {}) as unknown as Prisma.InputJsonValue,
        },
      });
      return reply.status(201).send({ data: workspace });
    }
  );

  // GET /api/workspaces/:id
  fastify.get<{ Params: { id: string } }>(
    "/workspaces/:id",
    async (request, reply) => {
      const workspace = await prisma.workspace.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!workspace) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      return reply.send({ data: workspace });
    }
  );

  // PUT /api/workspaces/:id
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; layout?: WorkspaceLayout; chartType?: string };
  }>(
    "/workspaces/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            layout: LAYOUT_SCHEMA,
            chartType: { type: "string", enum: ["line", "candles"] },
          },
        },
      },
    },
    async (request, reply) => {
      const existing = await prisma.workspace.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const { name, layout, chartType } = request.body;
      const updated = await prisma.workspace.update({
        where: { id: request.params.id },
        data: {
          ...(name !== undefined && { name }),
          ...(layout !== undefined && { layout: sanitizeLayout(layout) as unknown as Prisma.InputJsonValue }),
          ...(chartType !== undefined && { chartType }),
        },
      });
      return reply.send({ data: updated });
    }
  );

  // DELETE /api/workspaces/:id
  fastify.delete<{ Params: { id: string } }>(
    "/workspaces/:id",
    async (request, reply) => {
      const existing = await prisma.workspace.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      await prisma.workspace.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    }
  );
};

/**
 * Drop panel grid items whose `i` key doesn't match any panel in the `panels` array.
 * This implements the F8 acceptance: "unknown panel IDs are dropped safely".
 */
function sanitizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const panelIds = new Set((layout.panels ?? []).map((p: PanelConfig) => p.id));
  const grid = (layout.grid ?? []).filter((item: LayoutItem) =>
    panelIds.has(item.i)
  );
  return { panels: layout.panels ?? [], grid };
}
