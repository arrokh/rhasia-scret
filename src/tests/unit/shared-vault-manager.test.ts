/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedVaultManager } from "@/modules/vault-management/presentation/shared-vault-manager";
import { TestQueryProvider } from "@/tests/test-query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

describe("SharedVaultManager", () => {
  let root: Root | undefined;
  afterEach(async () => act(async () => root?.unmount()));

  it("closes from a backdrop click but stays open for clicks inside the dialog", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await renderManager(root, managerProps());
    await act(async () => findButton(container, "Brankas Bersama").click());
    const dialog = container.querySelector<HTMLDialogElement>("dialog");
    if (!dialog) throw new Error("Expected dialog.");

    await act(async () => dialog.querySelector(".dialog-heading")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector("dialog")?.open).toBe(true);

    await act(async () => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("opens clickable vault details and confirms account deletion", async () => {
    const onAccountDeleted = vi.fn(async () => undefined);
    const container = document.createElement("div");
    root = createRoot(container);
    await renderManager(root, managerProps(onAccountDeleted));
    await act(async () => findButton(container, "Brankas Bersama").click());
    const vaultButton = container.querySelector<HTMLButtonElement>(".shared-vault-select");
    if (!vaultButton) throw new Error("Expected Shared Vault selection.");
    await act(async () => vaultButton.click());

    expect(container.querySelector('input[value="Tim Operasional"]')).not.toBeNull();
    expect(container.querySelector<HTMLAnchorElement>(".add-account-link")?.href).toContain("vaultId=shared-1");
    await act(async () => findButton(container, "Hapus Example person@example.test").click());
    expect(onAccountDeleted).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Hapus akun autentikator?");

    await act(async () => findButton(container, "Hapus akun").click());
    expect(onAccountDeleted).toHaveBeenCalledWith("shared-1", "account-1", 2);
  });

  it("shows decrypted Shared Vaults and opens creation from the plus control", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await renderManager(root, managerProps());

    await act(async () => findButton(container, "Brankas Bersama").click());
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.textContent).toContain("Tim Operasional");
    expect(container.textContent).toContain("Pemilik");

    await act(async () => findButton(container, "Buat Brankas Bersama").click());
    expect(container.querySelector("#shared-vault-name")).not.toBeNull();
    expect(container.querySelector('label[for="shared-vault-name"]')?.textContent).toBe("Nama Brankas Bersama");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain("Buat Brankas Bersama");
  });
});

function managerProps(onAccountDeleted = async () => undefined) {
  return {
    userRootKey: new Uint8Array(32),
    vaults: [{
      id: "shared-1",
      name: "Tim Operasional",
      role: "OWNER" as const,
      key: new Uint8Array(32),
      accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 2 }]
    }],
    onVaultCreated: () => undefined,
    onVaultRenamed: () => undefined,
    onAccountDeleted
  };
}

async function renderManager(root: Root, props: ReturnType<typeof managerProps>) {
  await act(async () => root.render(createElement(TestQueryProvider, null, createElement(SharedVaultManager, props))));
}

function findButton(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
