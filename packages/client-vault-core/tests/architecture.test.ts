import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("client-vault-core boundaries", () => {
  it("has no application, server, framework, or platform imports", () => {
    const forbidden =
      /next(?:\/|['"]|$)|react(?:-dom|-native)?(?:\/|['"]|$)|expo(?:\/|['"]|$)|@prisma|@supabase|indexedDB|localStorage|sessionStorage|from ["'](?:fs|node:fs|http|https)["']/;
    for (const path of sourceFiles(join(process.cwd(), "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(forbidden);
    }
  });

  it("exposes one public entry point for extracted consumers", () => {
    expect(readFileSync(join(process.cwd(), "src/index.ts"), "utf8")).toContain("export *");
  });
});
