/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedVaultManager } from "@/modules/vault-management/presentation/shared-vault-manager";
import { TestQueryProvider } from "@/tests/test-query-provider";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("SharedVaultManager", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; });

  it("uses shadcn dialog dismissal while preserving inside interactions", async () => {
    const container = mount(); root = createRoot(container); await renderManager(root, managerProps());
    await act(async () => findButton(container, "Brankas Bersama").click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => dialog?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const close = dialog?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    await act(async () => close?.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens vault details and confirms account deletion", async () => {
    const onAccountDeleted = vi.fn(async () => undefined);
    const container = mount(); root = createRoot(container); await renderManager(root, managerProps(onAccountDeleted));
    await act(async () => findButton(container, "Brankas Bersama").click());
    await act(async () => findButton(document.body, "Tim Operasional2 akun · PemilikPemilik").click());
    expect(document.body.querySelector('input[value="Tim Operasional"]')).not.toBeNull();
    expect(document.body.querySelector<HTMLAnchorElement>('a[href*="vaultId=shared-1"]')).not.toBeNull();
    await act(async () => findButton(document.body, "Hapus Example person@example.test").click());
    expect(onAccountDeleted).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Hapus akun autentikator?");
    const dialogs = document.body.querySelectorAll('[role="dialog"]');
    await act(async () => findButton(dialogs[dialogs.length - 1], "Hapus akun").click());
    expect(onAccountDeleted).toHaveBeenCalledWith("shared-1", "account-1", 2);
  });

  it("shows decrypted Shared Vaults and opens creation", async () => {
    const container = mount(); root = createRoot(container); await renderManager(root, managerProps());
    await act(async () => findButton(container, "Brankas Bersama").click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Tim Operasional");
    expect(document.body.textContent).toContain("Pemilik");
    await act(async () => findButton(document.body, "Buat Brankas Bersama").click());
    expect(document.body.querySelector("#shared-vault-name")).not.toBeNull();
    expect(document.body.querySelector('label[for="shared-vault-name"]')?.textContent).toBe("Nama Brankas Bersama");
    expect(document.body.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain("Buat Brankas");
  });
});

function mount() { const container = document.createElement("div"); document.body.append(container); return container; }
function managerProps(onAccountDeleted = async () => undefined) { return { userRootKey: new Uint8Array(32), vaults: [{ id: "shared-1", name: "Tim Operasional", role: "OWNER" as const, key: new Uint8Array(32), accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 2 }, { id: "account-2", issuer: "Other", accountName: "other@example.test", revision: 1 }] }], onVaultCreated: () => undefined, onVaultRenamed: () => undefined, onAccountDeleted }; }
async function renderManager(root: Root, props: ReturnType<typeof managerProps>) { await act(async () => root.render(createElement(TestQueryProvider, null, createElement(SharedVaultManager, props)))); }
function findButton(container: ParentNode, name: string): HTMLButtonElement { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") || candidate.getAttribute("aria-label") === name); if (!button) throw new Error(`Expected button: ${name}`); return button; }
