import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadVaultPageContext: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/identity", () => ({ LogoutForm: () => null }));
vi.mock("@/modules/vault-management/presentation/load-vault-page-context", () => ({
  loadVaultPageContext: mocks.loadVaultPageContext,
}));
vi.mock("@/modules/authenticator-account/presentation/vault-workspace-unlock", () => ({
  VaultWorkspaceUnlock: () => createElement("h2", null, "Brankas Anda terkunci"),
}));

import VaultDirectoryPage from "@/app/vaults/manage/page";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("VaultDirectoryPage archive navigation", () => {
  beforeEach(() => {
    mocks.loadVaultPageContext.mockResolvedValue({
      user: { id: "user-1", email: "person@example.test", status: "ACTIVE" },
      personalVault: { id: "personal-1", lifecycle: "ACTIVE" },
    });
  });

  it("streams the stable page header while only the protected action and directory are pending", async () => {
    mocks.loadVaultPageContext.mockReturnValue(new Promise(() => undefined));

    const markup = renderToStaticMarkup(
      createElement(
        TestQueryProvider,
        null,
        createElement(UnlockedVaultWorkspaceProvider, null, await VaultDirectoryPage()),
      ),
    );

    expect(markup).toContain("Buka Brankas Pribadi atau kelola Brankas Bersama Anda.");
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).not.toContain("Brankas Anda terkunci");
  });

  it("hides backup and import while the Vault Directory is locked", async () => {
    const markup = await renderFully(
      createElement(
        TestQueryProvider,
        null,
        createElement(UnlockedVaultWorkspaceProvider, null, await VaultDirectoryPage()),
      ),
    );

    expect(markup).toContain("Brankas Anda terkunci");
    expect(markup).not.toContain('href="/vaults/backup"');
    expect(markup).not.toContain('href="/vaults/import"');
  });

  it("shows icon-only archive actions beside Shared Vault in a current Unlocked Vault Session", async () => {
    const markup = await renderFully(
      createElement(
        TestQueryProvider,
        null,
        createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: workspace() }, await VaultDirectoryPage()),
      ),
    );

    expect(markup).toContain('aria-label="Aksi arsip Brankas"');
    expect(markup).toContain("grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:shrink-0");
    expect(markup).toContain(
      'aria-label="Buat cadangan" title="Buat cadangan" data-slot="button" data-variant="outline" data-size="icon"',
    );
    expect(markup).toContain(
      'aria-label="Import arsip" title="Import arsip" data-slot="button" data-variant="outline" data-size="icon"',
    );
    expect(markup).toContain('href="/vaults/manage/new"');
    expect(markup).toContain("lucide-database-backup");
    expect(markup).toContain("lucide-import");
    expect(markup).not.toContain("lucide-download");
    expect(markup).not.toContain("lucide-upload");
  });
});

async function renderFully(element: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function workspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "sync-1",
    syncState: "CURRENT",
    userRootKey: Uint8Array.of(1),
    vaults: [
      {
        id: "personal-1",
        name: "Brankas Pribadi",
        type: "PERSONAL",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
        },
        key: Uint8Array.of(2),
      },
    ],
    accounts: [],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}
