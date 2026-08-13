import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, env } from "prisma/config";

// Workspace commands run from apps/web while the repository keeps one root
// environment contract. The root file supplies a shared local fallback and
// app-local files can add values without committing credentials.
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DIRECT_URL") },
});
