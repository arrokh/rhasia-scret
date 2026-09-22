import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStagedMigrationConfig } from "./staged-migration-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("staged migration config", () => {
  it("provides package resolution for a config staged outside the API workspace", async () => {
    const appRoot = await mkdtemp(join(tmpdir(), "rhasia-scret-staged-config-test-"));
    temporaryDirectories.push(appRoot);
    const migrationsRoot = join(appRoot, "prisma/migrations");
    const additiveMigration = join(migrationsRoot, "20260914035650_add_passwordless_auth_state");
    await mkdir(additiveMigration, { recursive: true });
    await mkdir(join(appRoot, "node_modules/prisma"), { recursive: true });
    await writeFile(join(migrationsRoot, "migration_lock.toml"), 'provider = "postgresql"\n');
    await writeFile(join(additiveMigration, "migration.sql"), "-- synthetic test migration\n");
    await writeFile(
      join(appRoot, "node_modules/prisma/package.json"),
      JSON.stringify({ type: "module", exports: { "./config": "./config.js" } }),
    );
    await writeFile(
      join(appRoot, "node_modules/prisma/config.js"),
      "export const defineConfig = (config) => config; export const env = (name) => process.env[name];",
    );

    const staging = await createStagedMigrationConfig(appRoot);
    temporaryDirectories.push(staging.directory);
    const previousDirectUrl = process.env.DIRECT_URL;
    process.env.DIRECT_URL = "postgresql://localhost:5432/synthetic";

    try {
      await expect(readlink(join(staging.directory, "node_modules"))).resolves.toBe(join(appRoot, "node_modules"));
      await expect(import(`${staging.configPath}?test=staged-migration-config`)).resolves.toBeDefined();
      await expect(readFile(staging.configPath, "utf8")).resolves.toContain('from "prisma/config"');
    } finally {
      if (previousDirectUrl === undefined) delete process.env.DIRECT_URL;
      else process.env.DIRECT_URL = previousDirectUrl;
    }
  });
});
