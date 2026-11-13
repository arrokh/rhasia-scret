import { defineConfig, env } from "prisma/config";

// Prisma remains available only to the TypeScript parity oracle. Sqitch owns all schema changes.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DIRECT_URL") },
});
