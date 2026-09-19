import { describe, expect, it } from "vitest";

describe("Prisma database integration seam", () => {
  it.skipIf(!process.env.DATABASE_URL)("connects to the configured test database", async () => {
    const { prisma } = await import("@api/tests/integration/prisma");
    try {
      const result = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;
      expect(result[0]?.value).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
