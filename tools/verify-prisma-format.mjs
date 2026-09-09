import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = process.cwd();
const schemaPath = resolve(repositoryRoot, "apps/web/prisma/schema.prisma");
const source = readFileSync(schemaPath, "utf8");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "rhasia-scret-prisma-format-"));
const temporarySchemaPath = join(temporaryDirectory, "schema.prisma");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  writeFileSync(temporarySchemaPath, source);
  const result = spawnSync(
    pnpmCommand,
    ["--dir", "apps/web", "exec", "prisma", "format", "--schema", temporarySchemaPath],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DIRECT_URL: process.env.DIRECT_URL ?? "postgresql://localhost:5432/rhasia_scret_format_check",
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const formatted = readFileSync(temporarySchemaPath, "utf8");
  if (formatted !== source) {
    console.error("Prisma schema is not formatted. Run `pnpm run format:prisma`.");
    process.exit(1);
  }

  console.log("Prisma schema is formatted.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
