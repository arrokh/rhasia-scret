/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddLocalAccountForm } from "@/modules/local-vault/presentation/local-vault-page";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Local Vault account import", () => {
  it("shows a parser error instead of silently discarding an invalid import", async () => {
    const container = mount();
    root = createRoot(container);
    await act(async () => root?.render(createElement(AddLocalAccountForm, { onAdd: vi.fn() })));

    await enterManualUri(container, "not-an-otpauth-uri");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("URI autentikator tidak valid");
    expect(container.querySelector("#local-account-label")).toBeNull();
  });

  it("reviews and saves a valid URI imported manually", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const container = mount();
    root = createRoot(container);
    await act(async () => root?.render(createElement(AddLocalAccountForm, { onAdd })));

    await enterManualUri(container, "otpauth://totp/Example:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example");

    expect(container.textContent).toContain("Tinjau akun lokal");
    expect(container.querySelector<HTMLInputElement>("#local-account-label")?.value).toBe("alice@example.com");
    await act(async () => findButton(container, "Simpan ke Brankas Lokal").click());

    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ issuer: "Example", accountName: "alice@example.com", algorithm: "SHA-1", digits: 6, period: 30 });
    expect(container.querySelector("#local-account-label")).toBeNull();
  });
});

async function enterManualUri(container: HTMLElement, uri: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("#manual-authenticator-uri");
  await act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, uri);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => findButton(container, "Gunakan URI manual").click());
}

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(name));
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
