import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";

const connectionString = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/rhasia_scret_test";

/** Integration suites skip without DATABASE_URL; the placeholder avoids eager client construction failures. */
export const prisma = createPrismaClient(connectionString);
