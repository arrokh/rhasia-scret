/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SharedVaultManager } from "@/modules/vault-management/presentation/shared-vault-manager";

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

  it("shows decrypted Shared Vaults and opens creation from the plus control", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(SharedVaultManager, {
      userRootKey: new Uint8Array(32),
      vaults: [{ id: "shared-1", name: "Tim Operasional", role: "OWNER" }]
    })));

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

function findButton(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
