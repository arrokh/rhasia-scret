import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePersonalVault: vi.fn(),
  loadApplicationUser: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/identity", () => ({ LogoutForm: () => null }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: mocks.loadApplicationUser }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class PrismaApplicationUserRepository {}
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({
  SupabaseSessionVerifier: class SupabaseSessionVerifier {}
}));
vi.mock("@/modules/vault-management/application/ensure-personal-vault", () => ({ ensurePersonalVault: mocks.ensurePersonalVault }));
vi.mock("@/modules/vault-management/infrastructure/prisma-personal-vault-repository", () => ({
  PrismaPersonalVaultRepository: class PrismaPersonalVaultRepository {}
}));
vi.mock("@/modules/authenticator-account/presentation/vault-workspace-unlock", () => ({
  VaultWorkspaceUnlock: () => createElement("h2", null, "Brankas Anda terkunci")
}));

import VaultDirectoryPage from "@/app/vaults/manage/page";
import { UnlockedVaultWorkspaceProvider, type UnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("VaultDirectoryPage archive navigation", () => {
  beforeEach(() => {
    mocks.loadApplicationUser.mockResolvedValue({ id: "user-1", email: "person@example.test", canAccessApplication: () => true });
    mocks.ensurePersonalVault.mockResolvedValue({ id: "personal-1", lifecycle: "ACTIVE" });
  });

  it("hides backup and import while the Vault Directory is locked", async () => {
    const markup = renderToStaticMarkup(createElement(
      TestQueryProvider,
      null,
      createElement(UnlockedVaultWorkspaceProvider, null, await VaultDirectoryPage())
    ));

    expect(markup).toContain("Brankas Anda terkunci");
    expect(markup).not.toContain('href="/vaults/backup"');
    expect(markup).not.toContain('href="/vaults/import"');
  });

  it("shows responsive Download and Upload actions in a current Unlocked Vault Session", async () => {
    const markup = renderToStaticMarkup(createElement(
      TestQueryProvider,
      null,
      createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: workspace() }, await VaultDirectoryPage())
    ));

    expect(markup).toContain('aria-label="Aksi arsip Brankas"');
    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain('href="/vaults/backup"');
    expect(markup).toContain('href="/vaults/import"');
    expect(markup).toContain("lucide-download");
    expect(markup).toContain("lucide-upload");
  });
});

function workspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "sync-1",
    syncState: "CURRENT",
    userRootKey: Uint8Array.of(1),
    vaults: [{ id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", effectiveAccountPermissions: { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" } }, key: Uint8Array.of(2) }],
    accounts: [],
    unavailableAccounts: [],
    unavailableSharedVaults: 0
  };
}
