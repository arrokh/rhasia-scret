import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export type PrismaDatabase = PrismaClient;

/** Keep each standalone API process or serverless instance bounded to five PostgreSQL connections. */
export const API_DATABASE_POOL_MAX = 5;

export function createPrismaClient(connectionString: string): PrismaDatabase {
  if (!connectionString) throw new Error("A database connection string is required to create the API Prisma client.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: API_DATABASE_POOL_MAX }),
  });
}
