import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const read = (relativePath: string): string => readFileSync(resolve(repositoryRoot, relativePath), "utf8");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

describe("Go API runtime and migration boundaries", () => {
  it("leaves the Web App Router with the generic versioned API proxy", () => {
    const routePath = "apps/web/src/app/api/[...path]/route.ts";
    const apiRoot = resolve(repositoryRoot, "apps/web/src/app/api");
    const entries = readFileSync(resolve(apiRoot, "[...path]/route.ts"), "utf8");
    expect(entries).toContain('path[0] !== "v1"');
    expect(entries).toContain("API_ORIGIN");
    expect(entries).toContain("API_PROXY_SECRET");
    expect(routePath).toBe("apps/web/src/app/api/[...path]/route.ts");
  });

  it("keeps persistence and server-only dependencies out of the Web package", () => {
    const packageJson = readJson("apps/web/package.json") as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    expect(dependencies).not.toEqual(
      expect.arrayContaining(["@prisma/client", "@prisma/adapter-pg", "pg", "nodemailer"]),
    );
  });

  it("uses Go handlers for all Vercel API functions and preserves project routing", () => {
    const goModule = read("apps/api/go.mod");
    const entry = read("apps/api/api/index.go");
    const health = read("apps/api/api/health/index.go");
    const time = read("apps/api/api/time/index.go");
    const vercel = readJson("apps/api/vercel.json") as {
      framework?: null;
      regions?: string[];
      installCommand?: string;
      buildCommand?: string;
      ignoreCommand?: string;
      git?: { deploymentEnabled?: Record<string, boolean> };
      rewrites?: Array<{ source?: string; destination?: string }>;
      functions?: Record<string, { maxDuration?: number }>;
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(goModule).toContain("module github.com/nooroctavian/rhasia-scret/apps/api");
    expect(goModule).toContain("toolchain go1.27.4");
    expect(entry).toContain("vercelruntime.NewAPIHandler()");
    expect(health).toContain("vercelruntime.NewHealthHandler()");
    expect(time).toContain("vercelruntime.NewTimeHandler()");
    expect(`${entry}\n${health}\n${time}`).not.toMatch(/^\s*(?:[A-Za-z_]\w*\s+)?["'][^"']*\/internal\/[^"']*["']\s*$/m);
    expect(vercel.framework).toBeNull();
    expect(vercel.regions).toEqual(["sin1"]);
    expect(vercel.installCommand).toBe("true");
    expect(vercel.buildCommand).toBe("true");
    expect(vercel.ignoreCommand).toBe("node ../../tools/vercel-ignore.mjs api");
    expect(vercel.git?.deploymentEnabled).toEqual({ main: true, "**": false });
    expect(vercel.rewrites).toEqual([
      { source: "/v1/health", destination: "/api/health" },
      { source: "/v1/time", destination: "/api/time" },
      { source: "/v1/(.*)", destination: "/api" },
    ]);
    expect(vercel.functions).toEqual({
      "api/index.go": { maxDuration: 60 },
      "api/health/index.go": { maxDuration: 10 },
      "api/time/index.go": { maxDuration: 10 },
    });
    expect(vercel.crons).toEqual([{ path: "/v1/internal/retention-purge", schedule: "0 3 * * *" }]);
    for (const oldAdapter of ["apps/api/api/index.ts", "apps/api/api/health.ts", "apps/api/api/time.ts"]) {
      expect(existsSync(resolve(repositoryRoot, oldAdapter))).toBe(false);
    }
  });

  it("builds a minimal Go API image and an isolated Sqitch-only migration image", () => {
    const apiDockerfile = read("apps/api/Dockerfile");
    const migrationDockerfile = read("apps/api/Dockerfile.migration");
    const migrationRunner = read("apps/api/cmd/sqitch-migrate/main.go");
    const compose = read("docker-compose.yml");
    const productionMigrationCompose = read("docker-compose.prod-migration.yml");
    const selfHostedCompose = read("docker-compose.selfhosted.yml");
    const apiService = compose.match(/^  api:\n([\s\S]*?)^  web:/m)?.[1] ?? "";
    const migrationService = compose.match(/^  migrate:\n([\s\S]*?)^  api:/m)?.[1] ?? "";
    const schedulerService = compose.match(/^  retention-purge:\n([\s\S]*?)^networks:/m)?.[1] ?? "";

    expect(apiDockerfile).toContain("golang:1.27.4-alpine3.24@");
    expect(apiDockerfile).toContain("go build -trimpath");
    expect(apiDockerfile).toContain("/usr/local/bin/api");
    expect(apiDockerfile).toContain('CMD ["serve"]');
    expect(apiDockerfile).not.toMatch(/\b(?:node|bun|pnpm|prisma)\b/i);
    const apiRuntime = apiDockerfile.split(" AS runtime\n").at(-1) ?? "";
    expect(apiRuntime).not.toMatch(/\b(?:go|node|bun|pnpm|prisma)\b/i);

    expect(migrationDockerfile).toContain("sqitch/sqitch:v1.6.1.1@");
    expect(migrationDockerfile).toContain("cmd/sqitch-migrate");
    expect(migrationDockerfile).toContain("db/sqitch");
    expect(migrationDockerfile).toContain('CMD ["deploy", "--verify"]');
    expect(migrationDockerfile).not.toMatch(/\b(?:node|bun|pnpm|prisma)\b/i);
    expect(migrationRunner).toContain('os.Getenv("DIRECT_URL")');
    expect(migrationRunner).toContain('"schema"');
    expect(migrationRunner).toContain('"SQITCH_TARGET"');
    expect(migrationRunner).toContain('name == "DATABASE_URL"');
    expect(migrationRunner).not.toContain('os.Getenv("DATABASE_URL")');

    expect(apiService).toContain("DATABASE_URL:");
    expect(apiService).not.toContain("DIRECT_URL:");
    expect(selfHostedCompose).toContain("DEPLOYMENT_TARGET: selfhosted");
    expect(apiService).toContain('test: ["CMD", "/usr/local/bin/api", "healthcheck"]');
    expect(migrationService).toContain("DIRECT_URL:");
    expect(migrationService).not.toContain("DATABASE_URL:");
    expect(schedulerService).toContain('command: ["retention-purge"]');
    expect(schedulerService).toContain("CRON_SECRET:");
    expect(schedulerService).not.toContain("DATABASE_URL:");
    expect(schedulerService).not.toContain("DIRECT_URL:");
    expect(productionMigrationCompose).toContain("DIRECT_URL:");
    expect(productionMigrationCompose).not.toContain("DATABASE_URL:");
  });

  it("keeps the TypeScript implementation as a test-only parity oracle", () => {
    const parityPackage = readJson("apps/api/package.json") as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const rootPackage = readJson("package.json") as { scripts?: Record<string, string> };
    const compose = read("docker-compose.yml");
    const localDev = read("tools/run-local-dev.mjs");
    const workspace = read("pnpm-workspace.yaml");
    const prismaConfig = read("apps/api/prisma.config.ts");
    const prismaArchive = read("apps/api/prisma/archive/README.md");

    expect(parityPackage.name).toBe("@rhasia-scret/api-parity");
    expect(parityPackage.dependencies ?? {}).toEqual({});
    expect(parityPackage.devDependencies).toHaveProperty("@prisma/client");
    expect(parityPackage.devDependencies).toHaveProperty("prisma");
    expect(parityPackage.scripts?.build).toBe("go build ./...");
    expect(parityPackage.scripts?.["test:parity:generate"]).toContain("prisma generate");
    expect(parityPackage.scripts?.postinstall).toBeUndefined();
    for (const script of Object.keys(parityPackage.scripts ?? {})) {
      expect(script).not.toMatch(/^prisma:migrate/);
      expect(script).not.toMatch(/^prisma:preflight/);
    }
    expect(rootPackage.scripts?.["sqitch:deploy"]).toContain("tools/sqitch-operation.mjs deploy");
    expect(rootPackage.scripts?.["sqitch:verify"]).toContain("tools/sqitch-operation.mjs verify");
    expect(rootPackage.scripts?.["prisma:migrate:deploy"]).toBeUndefined();
    expect(workspace).not.toContain("api-migration-runtime");
    expect(localDev).toContain('"go@1.27.4", "--", "go", "run", "./cmd/api", "serve"');
    expect(compose).not.toContain("bun");
    expect(prismaConfig).not.toMatch(/\bmigrations\s*:/u);
    expect(prismaArchive).toContain("Sqitch is the sole schema-migration authority");
    for (const retiredMigrationTool of [
      "apps/api/scripts/admin-prisma-client.ts",
      "apps/api/scripts/deploy-passwordless-migrations.ts",
      "apps/api/scripts/preflight-passwordless-migration.ts",
      "apps/api/scripts/seed-passwordless-identities.ts",
      "apps/api/scripts/staged-migration-config.ts",
      "apps/api/scripts/verify-passwordless-migration.ts",
      "apps/api/scripts/verify-prisma-connections.ts",
    ]) {
      expect(existsSync(resolve(repositoryRoot, retiredMigrationTool))).toBe(false);
    }
    expect(existsSync(resolve(repositoryRoot, "apps/api/prisma/migrations"))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, "apps/api/prisma/archive/migrations"))).toBe(true);
    expect(existsSync(resolve(repositoryRoot, "apps/api/db/sqitch/deploy/init.sql"))).toBe(true);
  });
});
