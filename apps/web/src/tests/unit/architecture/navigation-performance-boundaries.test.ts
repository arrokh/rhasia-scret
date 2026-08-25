import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("navigation and interaction performance boundaries", () => {
  it("keeps protected routes behind request-cached fresh authorization context", () => {
    const loader = source("src/modules/vault-management/presentation/load-vault-page-context.ts");
    expect(loader).toContain("cache(() => resolveVaultPageContext");
    expect(loader).toContain('context.user.status !== "ACTIVE"');
    expect(loader).not.toMatch(/use cache/);
  });

  it("provides nested loading boundaries without duplicate progressbar fallbacks", () => {
    expect(source("src/app/vaults/loading.tsx")).toContain("PageLoadingSkeleton");
    expect(source("src/app/vaults/manage/loading.tsx")).toContain("PageLoadingSkeleton");
    expect(source("src/shared/presentation/page-loading-skeleton.tsx")).not.toContain('role="progressbar"');
  });

  it("uses one shared visible-page clock instead of a timer per TOTP card", () => {
    const card = source("src/modules/otp-runtime/presentation/totp-account-button.tsx");
    const clock = source("src/modules/otp-runtime/presentation/use-totp-clock.ts");
    expect(card).toContain("useTotpClock()");
    expect(card).not.toContain("setInterval");
    expect(card).toContain("counter * configuration.period");
    expect(clock).toContain('document.visibilityState === "hidden"');
  });

  it("loads the QR decoder only after a scan action", () => {
    const importer = source("src/modules/authenticator-account/infrastructure/browser-qr-importer.ts");
    expect(importer).toContain('import("@zxing/browser")');
    expect(importer).not.toContain('import { BrowserQRCodeReader');
  });

  it("fully prefetches only the two high-probability Vault directory transitions", () => {
    expect(source("src/modules/authenticator-account/presentation/personal-vault-accounts.tsx")).toContain('<Link href="/vaults/manage" prefetch={true}');
    expect(source("src/app/vaults/manage/page.tsx")).toContain("backPrefetch");
    expect(source("src/modules/vault-management/presentation/shared-vault-manager.tsx")).not.toContain("prefetch={true}");
  });

  it("keeps Cache Components and dynamic stale-time caching disabled for sensitive forms", () => {
    const config = source("next.config.ts");
    expect(config).not.toMatch(/cacheComponents|staleTimes/);
  });
});
