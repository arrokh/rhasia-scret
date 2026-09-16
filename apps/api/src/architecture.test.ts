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

  it("keeps Worker and Bun composition separate while sharing the Hono app", () => {
    const worker = read("apps/api/src/index.ts");
    const bun = read("apps/api/src/bun.ts");
    expect(worker).toContain("app.fetch");
    expect(worker).not.toContain("./bun");
    expect(bun).toContain("Bun.serve");
    expect(bun).toContain("app.fetch");
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
