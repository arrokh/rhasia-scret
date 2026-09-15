import { copyFile, cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { createAdminPrismaClient } from "./admin-prisma-client";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const ADDITIVE_MIGRATION = "20260914035650_add_passwordless_auth_state";
const DESTRUCTIVE_MIGRATION = "20260914035747_remove_legacy_identity_column";

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fullConfig = join(appRoot, "prisma.config.ts");
  const prisma = createAdminPrismaClient();
  let destructiveMigrationApplied = false;
  try {
    const migrationTable = await prisma.$queryRaw<Array<{ migration_table_exists: boolean }>>(
      Prisma.sql`SELECT to_regclass('_prisma_migrations') IS NOT NULL AS migration_table_exists`,
    );
    if (migrationTable[0]?.migration_table_exists) {
      const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>(
        Prisma.sql`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${DESTRUCTIVE_MIGRATION} AND finished_at IS NOT NULL`,
      );
      destructiveMigrationApplied = applied.length > 0;
    }
  } finally {
    await prisma.$disconnect();
  }

  if (!destructiveMigrationApplied) {
    const staging = await createStagedMigrationConfig(appRoot);
    try {
      await run(binary(appRoot, "prisma"), ["migrate", "deploy", "--config", staging.configPath], appRoot);
      await run(binary(appRoot, "tsx"), ["scripts/preflight-passwordless-migration.ts"], appRoot);
      await run(binary(appRoot, "tsx"), ["scripts/seed-passwordless-identities.ts"], appRoot);
      await run(binary(appRoot, "tsx"), ["scripts/verify-passwordless-migration.ts", "--staged"], appRoot);
    } finally {
      await rm(staging.directory, { recursive: true, force: true });
    }
  }

  await run(binary(appRoot, "prisma"), ["migrate", "deploy", "--config", fullConfig], appRoot);
  await run(binary(appRoot, "tsx"), ["scripts/verify-passwordless-migration.ts"], appRoot);
}

async function createStagedMigrationConfig(appRoot: string): Promise<{ directory: string; configPath: string }> {
  const sourceMigrations = join(appRoot, "prisma/migrations");
  const entries = await readdir(sourceMigrations, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory() && entry.name <= ADDITIVE_MIGRATION)
    .map((entry) => entry.name)
    .sort();
  if (!migrationNames.includes(ADDITIVE_MIGRATION))
    throw new Error(`Passwordless migration staging requires ${ADDITIVE_MIGRATION}.`);

  const directory = await mkdtemp(join(tmpdir(), "rhasia-scret-prisma-staged-migrations-"));
  await copyFile(join(sourceMigrations, "migration_lock.toml"), join(directory, "migration_lock.toml"));
  for (const migrationName of migrationNames)
    await cp(join(sourceMigrations, migrationName), join(directory, migrationName), { recursive: true });

  const configPath = join(directory, "prisma.config.ts");
  await writeFile(
    configPath,
    `import { defineConfig, env } from "prisma/config";\n\nexport default defineConfig({\n  schema: ${JSON.stringify(join(appRoot, "prisma/schema.prisma"))},\n  migrations: { path: ${JSON.stringify(directory)} },\n  datasource: { url: env("DIRECT_URL") },\n});\n`,
  );
  return { directory, configPath };
}

function binary(appRoot: string, name: "prisma" | "tsx"): string {
  return join(appRoot, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Passwordless migration deployment failed.");
  process.exitCode = 1;
});
