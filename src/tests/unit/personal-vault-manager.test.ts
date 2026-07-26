/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonalVaultDetails } from "@/modules/vault-management/presentation/personal-vault-manager";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Personal Vault management", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; });

  it("uses the Shared Vault management structure without Shared-only controls", async () => {
    const onAccountDeleted = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(PersonalVaultDetails, {
      vault: { id: "personal-1", name: "Brankas Pribadi", accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 3 }] },
      ownerEmail: "owner@example.test",
      onAccountDeleted
    })));

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.textContent).toContain("owner@example.test");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/vaults/accounts/new?vaultId=personal-1"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Undangan" || button.textContent === "Audit")).toBe(false);

    await act(async () => findButton(container, "Hapus Example person@example.test").click());
    expect(document.body.textContent).toContain("Hapus akun autentikator?");
    await act(async () => findButton(document.body, "Hapus akun").click());
    expect(onAccountDeleted).toHaveBeenCalledWith("personal-1", "account-1", 3);
  });
});

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") || candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
