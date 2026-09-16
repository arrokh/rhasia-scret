import { PrismaClient } from "@prisma/client";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

loadWorkspaceEnvironment();
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for database integration checks.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Test database connection verified.");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
