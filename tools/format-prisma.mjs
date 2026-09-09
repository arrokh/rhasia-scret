import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = process.cwd();
const schemaPath = resolve(repositoryRoot, "apps/web/prisma/schema.prisma");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpmCommand, ["--dir", "apps/web", "exec", "prisma", "format", "--schema", schemaPath], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    DIRECT_URL: process.env.DIRECT_URL ?? "postgresql://localhost:5432/rhasia_scret_format_check",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
