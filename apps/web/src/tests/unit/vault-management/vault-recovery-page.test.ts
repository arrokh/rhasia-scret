import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadVaultPageContext: vi.fn(),
  getEligibility: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/crypto", () => ({
  PasskeyRecoveryReset: () => createElement("div", { "data-testid": "passkey-reset" }, "Passkey reset form"),
}));
vi.mock("@/modules/vault-management", () => ({
  DestructivePersonalVaultResetForm: () =>
    createElement("div", { "data-testid": "destructive-reset" }, "Destructive reset form"),
  OwnedSharedVaultResetBlocker: ({ vaultIds }: { vaultIds: string[] }) =>
    createElement("div", { "data-testid": "owned-vault-blocker" }, `${vaultIds.length} owned vaults`),
}));
vi.mock("@/modules/vault-management/presentation/load-vault-page-context", () => ({
  loadVaultPageContext: mocks.loadVaultPageContext,
}));
vi.mock("@/modules/vault-management/infrastructure/prisma-destructive-personal-vault-reset-repository", () => ({
  PrismaDestructivePersonalVaultResetRepository: class PrismaDestructivePersonalVaultResetRepository {
    public getEligibility(userId: string) {
      return mocks.getEligibility(userId);
    }
  },
}));

import VaultRecoveryPage from "@/app/vaults/recovery/page";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("VaultRecoveryPage", () => {
  beforeEach(() => {
    mocks.loadVaultPageContext.mockResolvedValue({
      user: { id: "user-1", email: "person@example.test", status: "ACTIVE" },
      personalVault: { id: "personal-1", lifecycle: "ACTIVE" },
    });
  });

  it("offers destructive reset when passkey recovery was not enrolled", async () => {
    mocks.getEligibility.mockResolvedValue({
      passkeyRecoveryEnrolled: false,
      activeOwnedSharedVaults: 0,
      activeOwnedSharedVaultIds: [],
    });

    const markup = await renderFully(createElement(TestQueryProvider, null, await VaultRecoveryPage()));

    expect(markup).toContain('data-testid="destructive-reset"');
    expect(markup).not.toContain('data-testid="passkey-reset"');
  });

  it("renders the non-destructive reset form when passkey recovery is enrolled", async () => {
    mocks.getEligibility.mockResolvedValue({
      passkeyRecoveryEnrolled: true,
      activeOwnedSharedVaults: 0,
      activeOwnedSharedVaultIds: [],
    });

    const markup = await renderFully(createElement(TestQueryProvider, null, await VaultRecoveryPage()));

    expect(markup).toContain('data-testid="passkey-reset"');
    expect(markup).not.toContain('data-testid="destructive-reset"');
  });

  it("blocks destructive reset while the user owns an active Shared Vault", async () => {
    mocks.getEligibility.mockResolvedValue({
      passkeyRecoveryEnrolled: false,
      activeOwnedSharedVaults: 2,
      activeOwnedSharedVaultIds: ["vault-1", "vault-2"],
    });

    const markup = await renderFully(createElement(TestQueryProvider, null, await VaultRecoveryPage()));

    expect(markup).toContain('data-testid="owned-vault-blocker"');
    expect(markup).toContain("2 owned vaults");
    expect(markup).not.toContain('data-testid="destructive-reset"');
  });
});

async function renderFully(element: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
