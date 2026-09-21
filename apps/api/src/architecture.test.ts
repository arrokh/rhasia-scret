import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const read = (relativePath: string): string => readFileSync(resolve(repositoryRoot, relativePath), "utf8");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe("API extraction ownership boundaries", () => {
  it("leaves the web App Router with only the generic versioned proxy", () => {
    const apiRoot = resolve(repositoryRoot, "apps/web/src/app/api");
    expect(files(apiRoot).map((path) => path.replace(`${repositoryRoot}/`, ""))).toEqual([
      "apps/web/src/app/api/[...path]/route.ts",
    ]);
    expect(read("apps/web/src/app/api/[...path]/route.ts")).toContain('path[0] !== "v1"');
  });

  it("keeps persistence and server-only dependencies out of the web package", () => {
    const packageJson = JSON.parse(read("apps/web/package.json")) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    expect(dependencies).not.toEqual(
      expect.arrayContaining(["@prisma/client", "@prisma/adapter-pg", "pg", "nodemailer"]),
    );
    const webSources = files(resolve(repositoryRoot, "apps/web/src"))
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(webSources).not.toMatch(/@prisma\/|from ["']pg["']|from ["']nodemailer["']/);
  });

  it("keeps standalone Bun, Node.js, and Vercel adapters separate while sharing the Hono app", () => {
    const app = read("apps/api/src/app.ts");
    const standalone = read("apps/api/src/standalone.ts");
    const bun = read("apps/api/src/bun.ts");
    const node = read("apps/api/src/node.ts");
    const vercel = read("apps/api/api/index.ts");
    const vercelHealth = read("apps/api/api/health.ts");
    const vercelTime = read("apps/api/api/time.ts");
    const vercelLoader = read("apps/api/api/load-bundle.ts");
    const vercelEntry = read("apps/api/src/vercel.ts");
    const vercelHealthEntry = read("apps/api/src/vercel-health.ts");
    const vercelTimeEntry = read("apps/api/src/vercel-time.ts");
    const tsupConfig = read("apps/api/tsup.config.ts");
    const vercelConfig = read("apps/api/vercel.json");
    const apiSources = files(resolve(repositoryRoot, "apps/api/src"))
      .filter((path) => path.endsWith(".ts") && !path.endsWith("architecture.test.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const packageJson = JSON.parse(read("apps/api/package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const compose = read("docker-compose.yml");
    const productionMigrationCompose = read("docker-compose.prod-migration.yml");
    const rootPackage = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const dockerfile = read("apps/api/Dockerfile");
    expect(app).not.toContain("export const app");
    expect(standalone).toContain("createApiRuntimeDependencies");
    expect(bun).toContain("Bun.serve");
    expect(bun).toContain("createStandaloneApi");
    expect(node).toContain("@hono/node-server");
    expect(node).toContain("createStandaloneApi");
    expect(vercel).toContain("createBundleHandler");
    expect(vercel).toContain('from "./load-bundle.js"');
    expect(vercel).toContain('"../dist/vercel.js"');
    expect(vercelHealth).toContain('from "./load-bundle.js"');
    expect(vercelHealth).toContain('"../dist/vercel-health.js"');
    expect(vercelTime).toContain('from "./load-bundle.js"');
    expect(vercelTime).toContain('"../dist/vercel-time.js"');
    expect(vercelLoader).toContain("import(bundleSpecifier)");
    expect(vercel).not.toContain("createRequire");
    expect(vercel).not.toContain("@api/");
    expect(vercelEntry).toContain("getRequestListener");
    expect(vercelEntry).toContain("normalizeVercelRequest");
    expect(vercelEntry).toContain('import("@api/standalone")');
    expect(vercelHealthEntry).toContain('"health"');
    expect(vercelTimeEntry).toContain('"time"');
    expect(tsupConfig).toContain("API_BUILD_TARGET");
    expect(tsupConfig).toContain("splitting: true");
    const vercelJson = JSON.parse(vercelConfig) as {
      framework?: null;
      regions?: string[];
      installCommand?: string;
      buildCommand?: string;
      ignoreCommand?: string;
      git?: { deploymentEnabled?: Record<string, boolean> };
      rewrites?: Array<{ source?: string; destination?: string }>;
      functions?: Record<string, { maxDuration?: number; includeFiles?: string }>;
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(vercelJson.framework).toBeNull();
    expect(vercelJson.regions).toEqual(["sin1"]);
    expect(vercelJson.installCommand).toContain("--frozen-lockfile");
    expect(vercelJson.ignoreCommand).toBe("node ../../tools/vercel-ignore.mjs api");
    expect(vercelJson.git?.deploymentEnabled).toEqual({ main: true, "**": false });
    expect(vercelJson.buildCommand).toBe(
      "DEPLOYMENT_TARGET=vercel VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config && pnpm run build:vercel",
    );
    expect(vercelJson.rewrites).toEqual([
      { source: "/v1/health", destination: "/api/health" },
      { source: "/v1/time", destination: "/api/time" },
      { source: "/v1/(.*)", destination: "/api" },
    ]);
    for (const functionName of ["api/index.ts", "api/health.ts", "api/time.ts"]) {
      expect(vercelJson.functions?.[functionName]?.maxDuration).toBe(60);
      expect(vercelJson.functions?.[functionName]?.includeFiles).toBe("dist/**");
    }
    expect(vercelJson.crons).toEqual([{ path: "/v1/internal/retention-purge", schedule: "0 3 * * *" }]);
    expect(apiSources).not.toContain("HYPERDRIVE");
    expect(packageJson.dependencies).toHaveProperty("@hono/node-server");
    expect(packageJson.devDependencies).not.toHaveProperty("wrangler");
    expect(packageJson.devDependencies).not.toHaveProperty("@cloudflare/workers-types");
    expect(packageJson.scripts).toHaveProperty("smoke:deployment");
    expect(packageJson.scripts?.["build:node"]).toBe("tsup --config tsup.config.ts");
    expect(packageJson.scripts?.["build:vercel"]).toContain("verify-vercel-bundle.ts");
    expect(existsSync(resolve(repositoryRoot, "apps/api/src/index.ts"))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, "apps/api/wrangler.jsonc"))).toBe(false);
    expect(compose).toContain("AUTH_ADMITTED_EMAILS: ${AUTH_ADMITTED_EMAILS:-}");
    expect(productionMigrationCompose).toContain(
      "DATABASE_URL: ${DATABASE_URL:?DATABASE_URL must be set in .env.prod}",
    );
    expect(productionMigrationCompose).toContain("DIRECT_URL: ${DIRECT_URL:?DIRECT_URL must be set in .env.prod}");
    expect(productionMigrationCompose).not.toMatch(/^\s+PROXY_SECRET:/m);
    expect(rootPackage.scripts?.["prod:db:migrate"]).toContain("-f docker-compose.prod-migration.yml");
    expect(rootPackage.scripts?.["prod:db:migrate"]).not.toContain(
      "-f docker-compose.yml -f docker-compose.prod-migration.yml",
    );
    expect(dockerfile).toContain("RUN pnpm --filter @rhasia-scret/api build:node");
    expect(dockerfile).toContain("COPY --from=build /workspace .");
    expect(compose).toContain("PASSKEY_RP_ID: ${PASSKEY_RP_ID:-}");
    expect(compose).toContain("PASSKEY_ORIGIN: ${PASSKEY_ORIGIN:-}");
    expect(existsSync(resolve(repositoryRoot, "apps/api/prisma/schema.prisma"))).toBe(true);
    expect(existsSync(resolve(repositoryRoot, "apps/web/prisma"))).toBe(false);
  });

  it("keeps browser-only code out of the API source tree", () => {
    const apiSources = files(resolve(repositoryRoot, "apps/api/src"))
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(apiSources).not.toMatch(/\"use client\"|\b(?:window|document|BroadcastChannel)\s*\./);
  });

  it("keeps client API packages free of API runtime and persistence imports", () => {
    const clientSources = files(resolve(repositoryRoot, "packages/api-contract/src"))
      .concat(files(resolve(repositoryRoot, "packages/api-client/src")))
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(clientSources).not.toMatch(/apps\/api|@prisma\/|from ["']pg["']|DATABASE_URL|PROXY_SECRET/);
  });
});
