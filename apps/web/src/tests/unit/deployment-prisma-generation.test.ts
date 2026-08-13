import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment Prisma Client generation", () => {
  it("regenerates Prisma Client immediately before every production build", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as { engines?: { node?: string }; scripts?: Record<string, string> };
    expect(packageJson.scripts?.prebuild).toBe("prisma generate");
    expect(packageJson.scripts?.postinstall).toBeUndefined();
    expect(packageJson.scripts?.postbuild).toContain("remove-client-source-maps.ts");
    expect(packageJson.scripts?.postbuild).toContain("verify:build-output");
    expect(packageJson.engines?.node).toBe("24.x");
  });

  it("declares the Vercel-supported Node.js major in the workspace root", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../../../../package.json", import.meta.url), "utf8")) as { engines?: { node?: string } };
    expect(packageJson.engines?.node).toBe("24.x");
  });
});
