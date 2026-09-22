import { copyFile, cp, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADDITIVE_MIGRATION = "20260914035650_add_passwordless_auth_state";

export async function createStagedMigrationConfig(appRoot: string): Promise<{ directory: string; configPath: string }> {
  const sourceMigrations = join(appRoot, "prisma/migrations");
  const entries = await readdir(sourceMigrations, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory() && entry.name <= ADDITIVE_MIGRATION)
    .map((entry) => entry.name)
    .sort();
  if (!migrationNames.includes(ADDITIVE_MIGRATION))
    throw new Error(`Passwordless migration staging requires ${ADDITIVE_MIGRATION}.`);

  const directory = await mkdtemp(join(tmpdir(), "rhasia-scret-prisma-staged-migrations-"));
  try {
    await symlink(
      join(appRoot, "node_modules"),
      join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await copyFile(join(sourceMigrations, "migration_lock.toml"), join(directory, "migration_lock.toml"));
    for (const migrationName of migrationNames)
      await cp(join(sourceMigrations, migrationName), join(directory, migrationName), { recursive: true });

    const configPath = join(directory, "prisma.config.ts");
    await writeFile(
      configPath,
      `import { defineConfig, env } from "prisma/config";\n\nexport default defineConfig({\n  schema: ${JSON.stringify(join(appRoot, "prisma/schema.prisma"))},\n  migrations: { path: ${JSON.stringify(directory)} },\n  datasource: { url: env("DIRECT_URL") },\n});\n`,
    );
    return { directory, configPath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
