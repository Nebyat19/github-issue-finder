import { PrismaClient } from "@prisma/client";

// Singleton to prevent multiple PrismaClients in Next.js
const globalForPrisma = globalThis as typeof globalThis & {
  __issueFinderPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__issueFinderPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "file:/data/dev.db",
      },
    },
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__issueFinderPrisma = prisma;
}