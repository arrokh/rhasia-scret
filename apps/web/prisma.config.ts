import { defineConfig, env } from "prisma/config";
import { loadWorkspaceEnvironment } from "./scripts/load-workspace-environment";

// The repository root owns the single local environment contract.
loadWorkspaceEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DIRECT_URL") },
});
