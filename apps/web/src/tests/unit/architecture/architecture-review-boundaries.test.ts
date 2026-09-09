import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoot = join(root, "src");
const appRoot = join(sourceRoot, "app");
const modulesRoot = join(sourceRoot, "modules");
const routesRoot = join(appRoot, "api");
const unitRoot = join(sourceRoot, "tests/unit");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("architecture review boundaries", () => {
  it("keeps App Router directories limited to Next.js convention files", () => {
    const nextConvention =
      /^(?:default|error|forbidden|global-error|layout|loading|manifest|not-found|page|robots|route|sitemap|template|unauthorized)\.(?:js|jsx|mdx|ts|tsx)$/;
    const staticMetadata =
      /^(?:apple-icon|icon|opengraph-image|twitter-image)\d*\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp)$|^(?:favicon\.ico|manifest\.(?:json|webmanifest)|robots\.txt|sitemap\.xml)$/;
    const violations = files(appRoot)
      .filter((path) => !nextConvention.test(basename(path)) && !staticMetadata.test(basename(path)))
      .map((path) => relative(root, path));
    expect(violations).toEqual([]);
  });

  it("keeps static brand metadata assets outside App Router source", () => {
    expect(existsSync(join(appRoot, "favicon.ico"))).toBe(false);
    expect(existsSync(join(appRoot, "icon.png"))).toBe(false);
    expect(existsSync(join(root, "public/assets/favicon.ico"))).toBe(true);
    expect(existsSync(join(root, "public/assets/icon.png"))).toBe(true);
    const layout = source("src/app/layout.tsx");
    expect(layout).toContain('url: "/assets/favicon.ico"');
    expect(layout).toContain('url: "/assets/icon.png"');
  });

  it("routes compose contexts only through public server seams", () => {
    const routeFiles = files(routesRoot).filter((path) => path.endsWith("route.ts"));
    const violations = routeFiles.flatMap((path) => {
      const imports = [...readFileSync(path, "utf8").matchAll(/from\s+["'](@\/modules\/[^"']+)["']/g)].map(
        (match) => match[1],
      );
      return imports
        .filter((specifier) => /\/(?:application|domain|infrastructure|presentation)\//.test(specifier))
        .map((specifier) => `${relative(root, path)} -> ${specifier}`);
    });
    const concreteAdapters = routeFiles
      .filter((path) => /\bPrisma[A-Z]|new\s+[A-Z][A-Za-z]+Repository\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(violations).toEqual([]);
    expect(concreteAdapters).toEqual([]);
  });

  it("keeps workspace reconciliation and key lifecycle out of presentation adapters", () => {
    const online = source("src/modules/authenticator-account/presentation/unlocked-vault-workspace-provider.tsx");
    const offline = source("src/modules/sync/presentation/offline-vault-shell.tsx");
    for (const presentation of [online, offline]) {
      expect(presentation).not.toContain("browserNetworkStatus");
      expect(presentation).not.toContain("browserApplicationLifecycle");
      expect(presentation).not.toContain("nextOfflineSyncState");
      expect(presentation).not.toContain("setBrowserWritesReadOnly");
      expect(presentation).not.toContain("refreshUnlockedVaultWorkspace");
    }
    expect(online).toContain("useWorkspaceLifecycle");
    expect(offline).toContain("useWorkspaceLifecycle");
    expect(existsSync(join(modulesRoot, "sync/application/workspace-lifecycle.ts"))).toBe(false);
    expect(source("../../packages/client-vault-core/src/modules/sync/application/workspace-lifecycle.ts")).toContain(
      "export class WorkspaceLifecycle",
    );
  });

  it("owns membership interaction behavior in Vault Membership", () => {
    const manager = source("src/modules/vault-management/presentation/shared-vault-manager.tsx");
    const membership = source("src/modules/vault-membership/presentation/vault-membership-owner-panel.tsx");
    expect(manager).toContain("VaultMembershipOwnerPanel");
    expect(manager).toContain("VaultMembershipDefaults");
    expect(manager).not.toContain("createSharedVaultInvitation");
    expect(manager).not.toContain("useVaultParticipantsQuery");
    expect(manager).not.toContain("MemberPermissionsDialog");
    expect(membership).toContain("createSharedVaultInvitation");
    expect(membership).toContain("MemberPermissionsDialog");
    expect(membership).toContain("useDeleteVaultParticipantMutation");
  });

  it("keeps the audit vocabulary, query, redaction, retention, and persistence adapter together", () => {
    for (const path of [
      "src/modules/audit/domain/vault-audit-event.ts",
      "src/modules/audit/domain/vault-audit-retention-policy.ts",
      "src/modules/audit/application/manage-vault-audit.ts",
      "src/modules/audit/application/purge-expired-vault-audit-events.ts",
      "src/modules/audit/infrastructure/prisma-vault-audit-appender.ts",
      "src/modules/audit/infrastructure/prisma-vault-audit-repository.ts",
      "src/modules/audit/presentation/vault-audit-history.tsx",
    ])
      expect(existsSync(join(root, path)), path).toBe(true);

    const directAppendsOutsideAudit = files(modulesRoot)
      .filter((path) => !path.includes("/audit/") && /\.(?:ts|tsx)$/.test(path))
      .filter((path) => /vaultAuditEvent\.(?:create|createMany)\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(directAppendsOutsideAudit).toEqual([]);
    expect(source("src/modules/audit/infrastructure/prisma-vault-audit-repository.ts")).toContain(
      "redactedAuditAction",
    );
  });

  it("mirrors domain-specific unit tests instead of keeping a flat unit directory", () => {
    const flatTests = readdirSync(unitRoot).filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"));
    expect(flatTests).toEqual([]);
    const groups = readdirSync(unitRoot)
      .filter((name) => statSync(join(unitRoot, name)).isDirectory())
      .sort();
    expect(groups).toEqual([
      "app-shell",
      "architecture",
      "audit",
      "authenticator-account",
      "crypto",
      "identity",
      "local-vault",
      "otp-runtime",
      "rate-limiting",
      "retention",
      "shared",
      "sync",
      "vault-archive",
      "vault-management",
      "vault-membership",
    ]);
  });
});
