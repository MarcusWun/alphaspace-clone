import { PrismaClient } from "@prisma/client";

// Global singleton pattern to prevent multiple connections in dev
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env["NODE_ENV"] === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient } from "@prisma/client";
export type { Prisma } from "@prisma/client";
export type {
  User,
  Account,
  Session,
  VerificationToken,
  Workspace,
  Watchlist,
  Alert,
  AlertStatus,
} from "@prisma/client";
