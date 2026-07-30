import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authenticated sign-in transition", () => {
  it("avoids a visible loading boundary before redirecting to the Vault loading state", () => {
    expect(existsSync(join(process.cwd(), "src/app/sign-in/loading.tsx"))).toBe(true);
    expect(source("src/app/sign-in/loading.tsx")).toContain("return null");
  });

  it("does not stream a second full accounts placeholder after the Vault route loads", () => {
    const vaultsPage = source("src/app/vaults/page.tsx");
    expect(vaultsPage).not.toContain("SectionLoadingPlaceholder");
    expect(vaultsPage.match(/<Suspense/g)).toHaveLength(1);
  });
});
