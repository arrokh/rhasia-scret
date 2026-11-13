import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/** Create a Prisma client for migration and verification tooling over DIRECT_URL. */
export function createAdminPrismaClient(): PrismaClient {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is required for Prisma administrative tooling.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
