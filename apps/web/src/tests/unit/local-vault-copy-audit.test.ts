/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addLocalAccount: vi.fn(),
  auditCopiesToLocal: vi.fn(),
  createPersonalAccount: vi.fn(),
  refreshUnlockedLocalVault: vi.fn(),
  unlockLocalVault: vi.fn()
}));

vi.mock("@/modules/authenticator-account", () => ({
  encryptAccountConfiguration: vi.fn(async () => new Uint8Array([1, 2, 3])),
  useCreateEncryptedAuthenticatorAccountMutation: () => ({ mutateAsync: mocks.createPersonalAccount })
}));
vi.mock("@/modules/local-vault", () => ({
  addLocalAccount: mocks.addLocalAccount,
  clearUnlockedLocalVault: vi.fn(),
  readLocalVaultRecord: vi.fn(async () => ({ profileId: "local-profile-1" })),
  refreshUnlockedLocalVault: mocks.refreshUnlockedLocalVault,
  unlockLocalVault: mocks.unlockLocalVault
}));
vi.mock("@/modules/vault-management", () => ({ recordPersonalVaultAccountCopiesToLocal: mocks.auditCopiesToLocal }));

import { LocalVaultCopyPanel } from "@/modules/local-vault/presentation/local-vault-copy-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const localAccount = { id: "local-account-1", revision: 1, issuer: "Local issuer", accountName: "local@example.test", secret: new Uint8Array([1, 2, 3]), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
const personalAccount = { id: "personal-account-1", revision: 1, vaultId: "personal-vault-1", vaultName: "Personal", vaultType: "PERSONAL" as const, issuer: "Personal issuer", accountName: "personal@example.test", secret: new Uint8Array([4, 5, 6]), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
const unlockedLocalVault = { profileId: "local-profile-1", name: "Device", rootKey: new Uint8Array(32), vaultKey: new Uint8Array(32), accounts: [localAccount] };

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Local and Personal Vault copy audit", () => {
  it("marks Local-to-Personal creation and audits Personal-to-Local source accounts", async () => {
    mocks.unlockLocalVault.mockResolvedValue(unlockedLocalVault);
    mocks.createPersonalAccount.mockResolvedValue({ id: "created-personal-1", revision: 1 });
    mocks.addLocalAccount.mockResolvedValue(undefined);
    mocks.refreshUnlockedLocalVault.mockResolvedValue(unlockedLocalVault);
    mocks.auditCopiesToLocal.mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(LocalVaultCopyPanel, {
      personalVaultId: "personal-vault-1",
      personalVaultName: "Personal",
      personalVaultKey: new Uint8Array(32),
      personalAccounts: [personalAccount],
      onPersonalAccountsCopied: vi.fn()
    })));
    await vi.waitFor(() => expect(container.querySelector("#copy-local-vault-passphrase")).not.toBeNull());
    await fill(container.querySelector<HTMLInputElement>("#copy-local-vault-passphrase"), "local-passphrase");
    await act(async () => findButton(container, "Buka untuk menyalin").click());
    await vi.waitFor(() => expect(container.querySelector("#copy-local-account-1")).not.toBeNull());

    await act(async () => container.querySelector<HTMLElement>("#copy-local-account-1")?.click());
    await act(async () => findButton(container, "Salin pilihan ke Brankas Pribadi").click());
    await vi.waitFor(() => expect(mocks.createPersonalAccount).toHaveBeenCalled());
    expect(mocks.createPersonalAccount).toHaveBeenCalledWith(expect.objectContaining({
      vaultId: "personal-vault-1",
      vaultType: "PERSONAL",
      source: "LOCAL_VAULT_COPY"
    }));

    await act(async () => container.querySelector<HTMLElement>("#copy-personal-account-1")?.click());
    await act(async () => findButton(container, "Salin pilihan ke Brankas Lokal").click());
    await vi.waitFor(() => expect(mocks.auditCopiesToLocal).toHaveBeenCalled());
    expect(mocks.auditCopiesToLocal).toHaveBeenCalledWith("personal-vault-1", ["personal-account-1"]);
  });

  it("keeps a successful local copy and warns when its audit request fails", async () => {
    mocks.unlockLocalVault.mockResolvedValue(unlockedLocalVault);
    mocks.addLocalAccount.mockResolvedValue(undefined);
    mocks.refreshUnlockedLocalVault.mockResolvedValue(unlockedLocalVault);
    mocks.auditCopiesToLocal.mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(LocalVaultCopyPanel, {
      personalVaultId: "personal-vault-1",
      personalVaultName: "Personal",
      personalVaultKey: new Uint8Array(32),
      personalAccounts: [personalAccount],
      onPersonalAccountsCopied: vi.fn()
    })));
    await vi.waitFor(() => expect(container.querySelector("#copy-local-vault-passphrase")).not.toBeNull());
    await fill(container.querySelector<HTMLInputElement>("#copy-local-vault-passphrase"), "local-passphrase");
    await act(async () => findButton(container, "Buka untuk menyalin").click());
    await vi.waitFor(() => expect(container.querySelector("#copy-personal-account-1")).not.toBeNull());
    await act(async () => container.querySelector<HTMLElement>("#copy-personal-account-1")?.click());
    await act(async () => findButton(container, "Salin pilihan ke Brankas Lokal").click());

    await vi.waitFor(() => expect(container.textContent).toContain("aktivitas Brankas Pribadinya tidak dapat dicatat"));
    expect(mocks.addLocalAccount).toHaveBeenCalledOnce();
  });
});

async function fill(input: HTMLInputElement | null, value: string): Promise<void> {
  await act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(name));
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
