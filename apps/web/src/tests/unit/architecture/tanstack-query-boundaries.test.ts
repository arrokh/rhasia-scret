import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("TanStack Query boundaries", () => {
  it("centralizes browser HTTP transport in the shared API client", () => {
    const fetchFiles = sourceFiles(sourceRoot)
      .filter((path) => !path.includes("/app/") && !path.includes("/tests/"))
      .filter((path) => /(?:^|[^.\w])fetch\(/m.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));

    expect(fetchFiles).toEqual([
      "src/shared/infrastructure/browser-api-client.ts",
      "src/shared/infrastructure/server-api-gateway.ts",
    ]);
  });

  it("keeps every context-owned React Query operation in a presentation hook", () => {
    const queryImports = sourceFiles(join(sourceRoot, "modules"))
      .filter((path) => readFileSync(path, "utf8").includes("@tanstack/react-query"))
      .map((path) => relative(process.cwd(), path));

    expect(queryImports).toEqual([
      "src/modules/audit/presentation/hooks/use-vault-audit-query.ts",
      "src/modules/authenticator-account/presentation/hooks/use-authenticator-account-mutations.ts",
      "src/modules/identity/presentation/hooks/use-passkey-recovery-status-query.ts",
      "src/modules/identity/presentation/hooks/use-session-mutations.ts",
      "src/modules/otp-runtime/presentation/hooks/use-server-time-query.ts",
      "src/modules/vault-management/presentation/hooks/use-personal-vault-mutations.ts",
      "src/modules/vault-management/presentation/hooks/use-shared-vault-mutations.ts",
      "src/modules/vault-membership/presentation/hooks/use-vault-participants.ts",
    ]);
  });

  it("keeps the session bridge in shared infrastructure and remounts account observers", () => {
    const provider = readFileSync(join(sourceRoot, "shared/presentation/query-provider.tsx"), "utf8");
    const bridge = readFileSync(
      join(sourceRoot, "shared/infrastructure/browser-authentication-session-change.ts"),
      "utf8",
    );

    const layout = readFileSync(join(sourceRoot, "app/layout.tsx"), "utf8");

    expect(provider).not.toContain("@/modules/sync");
    expect(provider).toContain("<Fragment key={session.epoch}>");
    expect(provider).toContain("client: createQueryClient()");
    for (const persistentRoot of [
      "<BrowserSessionRefresh />",
      "<BrowserAnalyticsBootstrap configuration={browserAnalyticsConfiguration} />",
      "<ServiceWorkerRegistration />",
      "<OfflineAccessPrompt />",
      "<NavigationProgress />",
    ]) {
      expect(layout.indexOf(persistentRoot)).toBeGreaterThanOrEqual(0);
      expect(layout.indexOf(persistentRoot)).toBeLessThan(layout.indexOf("<QueryProvider>"));
    }
    expect(layout.lastIndexOf("<AppFooter />")).toBeGreaterThan(layout.indexOf("</QueryProvider>"));
    expect(bridge).not.toContain("@/modules/");
    expect(bridge).not.toContain("@tanstack/react-query");
    expect(bridge).toContain('addEventListener("storage"');
  });

  it("keeps authentication callback pages query-free while preserving their redemption mount", () => {
    const provider = readFileSync(join(sourceRoot, "shared/presentation/query-provider.tsx"), "utf8");
    const webCallback = readFileSync(join(sourceRoot, "app/auth/confirm/page.tsx"), "utf8");
    const pwaCallback = readFileSync(join(sourceRoot, "app/auth/pwa-confirm/page.tsx"), "utf8");
    const confirmation = readFileSync(
      join(sourceRoot, "modules/identity/presentation/magic-link-confirmation.tsx"),
      "utf8",
    );
    const authConfiguration = readFileSync(
      join(process.cwd(), "../../apps/api/internal/service/identity_adapter_auth_configuration.go"),
      "utf8",
    );
    const secretState = readFileSync(
      join(sourceRoot, "modules/vault-membership/infrastructure/browser-secure-share-link-secret-state.ts"),
      "utf8",
    );

    expect(provider).toContain('window.location.pathname === "/auth/confirm"');
    expect(provider).toContain('window.location.pathname === "/auth/pwa-confirm"');
    for (const source of [webCallback, pwaCallback, confirmation]) {
      expect(source).not.toContain("@tanstack/react-query");
      expect(source).not.toMatch(/\buse(?:Query|Mutation)\s*\(/);
      expect(source).not.toMatch(/from\s+["'][^"']*\/presentation\/hooks(?:\/[^"']*)?["']/);
    }
    expect(webCallback).toContain("<MagicLinkConfirmation");
    expect(pwaCallback).toContain('client="pwa"');
    const apiTTL = authConfiguration.match(
      /readAuthTTL\(environment\.MagicLinkTTLSeconds,\s*defaultMagicLinkTTLSeconds,\s*\d+,\s*([\d_]+)\)/,
    );
    const clientLifetime = secretState.match(
      /SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/,
    );
    if (!apiTTL || !clientLifetime) throw new Error("The auth TTL bounds must remain explicit.");
    const clientLifetimeMs = Number(clientLifetime[1]) * Number(clientLifetime[2]) * Number(clientLifetime[3]);
    expect(clientLifetimeMs).toBe(Number(apiTTL[1].replaceAll("_", "")) * 1000);
  });

  it("installs one root provider without persistence", () => {
    const layout = readFileSync(join(sourceRoot, "app/layout.tsx"), "utf8");
    const provider = readFileSync(join(sourceRoot, "shared/presentation/query-provider.tsx"), "utf8");

    expect(layout).toContain("<QueryProvider>");
    expect(layout).toContain("<AppFooter />");
    expect(provider).toContain("new QueryClient");
    expect(provider).toContain("subscribeToBrowserAuthenticationSessionChange");
    expect(provider).toContain("current.client.clear()");
    expect(provider).not.toMatch(/persist|localStorage|sessionStorage|indexedDB/i);
  });
});
