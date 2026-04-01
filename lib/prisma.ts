import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  __issueFinderPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__issueFinderPrisma ??
  new PrismaClient({
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__issueFinderPrisma = prisma;
}
