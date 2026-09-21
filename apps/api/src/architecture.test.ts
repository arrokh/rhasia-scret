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
    const bun = read("apps/api/src/bun.ts");
    const node = read("apps/api/src/node.ts");
    const vercel = read("apps/api/api/[...path].ts");
    const vercelEntry = read("apps/api/src/vercel.ts");
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
    const dockerfile = read("apps/api/Dockerfile");
    expect(bun).toContain("Bun.serve");
    expect(bun).toContain("createStandaloneApi");
    expect(node).toContain("@hono/node-server");
    expect(node).toContain("createStandaloneApi");
    expect(vercel).toContain('"../dist/vercel.js"');
    expect(vercel).not.toContain("@api/");
    expect(vercelEntry).toContain("getRequestListener");
    expect(vercelEntry).toContain("normalizeVercelRequest");
    expect(tsupConfig).toContain('"src/vercel.ts"');
    const vercelJson = JSON.parse(vercelConfig) as {
      installCommand?: string;
      buildCommand?: string;
      rewrites?: Array<{ source?: string; destination?: string }>;
      functions?: Record<string, { maxDuration?: number; includeFiles?: string[] }>;
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(vercelJson.installCommand).toContain("--frozen-lockfile");
    expect(vercelJson.buildCommand).toBe(
      "DEPLOYMENT_TARGET=vercel VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config && pnpm run build",
    );
    expect(vercelJson.rewrites).toEqual([{ source: "/v1/:path*", destination: "/api/v1/:path*" }]);
    expect(vercelJson.functions?.["api/[...path].ts"]?.maxDuration).toBe(60);
    expect(vercelJson.functions?.["api/[...path].ts"]?.includeFiles).toEqual(["dist/vercel.js"]);
    expect(vercelJson.crons).toEqual([{ path: "/v1/internal/retention-purge", schedule: "0 3 * * *" }]);
    expect(apiSources).not.toContain("HYPERDRIVE");
    expect(packageJson.dependencies).toHaveProperty("@hono/node-server");
    expect(packageJson.devDependencies).not.toHaveProperty("wrangler");
    expect(packageJson.devDependencies).not.toHaveProperty("@cloudflare/workers-types");
    expect(packageJson.scripts).toHaveProperty("smoke:deployment");
    expect(packageJson.scripts?.["build:node"]).toContain("verify-vercel-bundle.ts");
    expect(existsSync(resolve(repositoryRoot, "apps/api/src/index.ts"))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, "apps/api/wrangler.jsonc"))).toBe(false);
    expect(compose).toContain("AUTH_ADMITTED_EMAILS: ${AUTH_ADMITTED_EMAILS:-}");
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
