/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ loadUnlockedVaultWorkspace: vi.fn() }));

vi.mock("@/modules/authenticator-account/infrastructure/browser-vault-workspace", () => ({
  loadUnlockedVaultWorkspace: mocks.loadUnlockedVaultWorkspace
}));
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/modules/crypto", () => ({ PasskeyRecoveryEnrollment: () => null }));
vi.mock("@/modules/vault-management", () => ({ SharedVaultManager: () => createElement("button", { type: "button" }, "Brankas Bersama") }));

import type { UnlockedVaultWorkspace } from "@/modules/authenticator-account/infrastructure/browser-vault-workspace";
import { PersonalVaultAccounts } from "@/modules/authenticator-account/presentation/personal-vault-accounts";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account/presentation/unlocked-vault-workspace-provider";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("PersonalVaultAccounts", () => {
  let root: Root | undefined;
  beforeEach(() => mocks.loadUnlockedVaultWorkspace.mockReset());
  afterEach(async () => act(async () => root?.unmount()));

  it("reuses the in-memory Unlocked Vault Session after returning from the add-account page", async () => {
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(
      createElement(TestQueryProvider, null, createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: workspace() }, createElement(PersonalVaultAccounts, { vaultId: "personal-1" })))
    ));

    expect(container.querySelector("#vault-unlock-secret")).toBeNull();
    expect(container.textContent).toContain("personal@example.test");
    expect(mocks.loadUnlockedVaultWorkspace).not.toHaveBeenCalled();
  });

  it("renders only the aggregated account list with vault provenance and a dedicated add-page link", async () => {
    mocks.loadUnlockedVaultWorkspace.mockResolvedValue(workspace());
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(
      createElement(TestQueryProvider, null, createElement(UnlockedVaultWorkspaceProvider, null, createElement(PersonalVaultAccounts, { vaultId: "personal-1" })))
    ));
    const recoveryLink = container.querySelector<HTMLAnchorElement>(".secondary-link");
    expect(recoveryLink?.textContent).toBe("Lupa Passphrase Brankas?");
    expect(recoveryLink?.pathname).toBe("/vaults/recovery");
    await act(async () => setInputValue(container.querySelector("#vault-unlock-secret"), "four random secret words"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.querySelectorAll(".account-list > li")).toHaveLength(2);
    expect(container.textContent).toContain("personal@example.test");
    expect(container.textContent).toContain("work@example.test");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(container.textContent).toContain("Tim Operasional");
    expect(container.querySelector<HTMLAnchorElement>('a[aria-label="Tambahkan akun autentikator"]')?.pathname).toBe("/vaults/accounts/new");
    expect(container.querySelector(".add-account-form")).toBeNull();
  });
});

function workspace(): UnlockedVaultWorkspace {
  return {
    userRootKey: Uint8Array.of(1),
    vaults: [
      { id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", key: Uint8Array.of(2) },
      { id: "shared-1", name: "Tim Operasional", type: "SHARED", role: "VIEWER", key: Uint8Array.of(3) }
    ],
    accounts: [
      { id: "account-1", vaultId: "personal-1", vaultName: "Brankas Pribadi", vaultType: "PERSONAL", revision: 1, issuer: "Example", accountName: "personal@example.test", secret: Uint8Array.of(4), algorithm: "SHA-1", digits: 6, period: 30 },
      { id: "account-2", vaultId: "shared-1", vaultName: "Tim Operasional", vaultType: "SHARED", revision: 1, issuer: "Work", accountName: "work@example.test", secret: Uint8Array.of(5), algorithm: "SHA-1", digits: 6, period: 30 }
    ],
    unavailableSharedVaults: 0
  };
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
