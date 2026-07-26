import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment Prisma Client generation", () => {
  it("regenerates Prisma Client immediately before every production build", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.prebuild).toBe("prisma generate");
  });
});
