import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const uiRoot = join(sourceRoot, "components/ui");
const visualRoots = [join(sourceRoot, "app"), join(sourceRoot, "modules"), join(sourceRoot, "shared")];

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("shadcn/ui design-system boundaries", () => {
  it("keeps shadcn configured as the sole component-system foundation", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "components.json"), "utf8")) as { style?: string; base?: string };
    expect(config.style).toBe("radix-nova");
    expect(filesUnder(uiRoot).length).toBeGreaterThan(10);
  });

  it("routes visible controls through shadcn primitives", () => {
    const violations = visualRoots.flatMap(filesUnder)
      .filter((path) => !path.endsWith("/app/global-error.tsx"))
      .filter((path) => !path.startsWith(uiRoot))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const withoutPermittedFileInput = source.replace(/<input className="sr-only"/g, "<FileInput");
        return /<(button|input|select|textarea|dialog|details|summary)(\s|>)/.test(withoutPermittedFileInput)
          ? [relative(process.cwd(), path)]
          : [];
      });
    expect(violations).toEqual([]);
  });

  it("keeps shared navigation, Query state, and the sticky footer at the application root", () => {
    const layout = readFileSync(join(sourceRoot, "app/layout.tsx"), "utf8");
    const appUi = readFileSync(join(sourceRoot, "shared/presentation/app-ui.tsx"), "utf8");
    expect(layout).toContain("<QueryProvider>");
    expect(layout).toContain("<AppFooter />");
    expect(appUi).toContain("fixed inset-x-0 bottom-0");
    expect(appUi).toContain("backHref");
  });

  it("keeps protected page headers consistent and avoids redundant text navigation", () => {
    const protectedPages = [
      "app/vaults/page.tsx",
      "app/vaults/accounts/new/page.tsx",
      "app/vaults/recovery/page.tsx",
      "app/vaults/manage/page.tsx",
      "app/vaults/manage/new/page.tsx",
      "app/vaults/manage/[vaultId]/page.tsx",
      "app/vaults/invitations/redeem/page.tsx"
    ];
    const frame = readFileSync(join(sourceRoot, "app/vaults/vault-page-frame.tsx"), "utf8");
    expect(frame).toContain("<PageHeader");
    expect(frame).toContain("<VaultPageLogoutAction");
    for (const page of protectedPages) {
      const source = readFileSync(join(sourceRoot, page), "utf8");
      expect(source).toMatch(/<PageHeader|<VaultPageFrame/);
      expect(source).toMatch(/VaultPageLogoutAction|VaultPageFrame/);
      expect(source).not.toMatch(/eyebrow=\"rhasia-scret/);
    }
    const backPages = protectedPages.slice(1);
    for (const page of backPages) {
      const source = readFileSync(join(sourceRoot, page), "utf8");
      expect(source).toContain("backHref=");
      expect(source).not.toMatch(/<Link[^>]+>\s*(Batal|Kembali)/);
    }
  });

  it("routes every Passphrase Brankas input through the accessible visibility control", () => {
    const rawPasswordInputs = visualRoots.flatMap(filesUnder)
      .filter((path) => !path.endsWith("password-input.tsx"))
      .filter((path) => readFileSync(path, "utf8").includes('type="password"'))
      .map((path) => relative(process.cwd(), path));
    expect(rawPasswordInputs).toEqual([]);
  });

  it("encodes the documented Rhasia palette and rejects the former indigo system", () => {
    const css = readFileSync(join(sourceRoot, "app/globals.css"), "utf8").toLowerCase();
    for (const color of ["#273039", "#171d22", "#e5a72e", "#c88717", "#f5d998", "#91867e", "#b9ada3", "#f8f4ed", "#fffdf9", "#ded8d0", "#3d7452", "#a5661b", "#a4433d", "#526d82"]) expect(css).toContain(color);
    expect(css).not.toMatch(/#312e81|#4f46e5|#172554|#f8fafc/);
    expect(css).not.toContain("gradient");
  });
});
