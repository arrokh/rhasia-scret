/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  clearAllOfflineVaultData: vi.fn(),
  requestLocalVaultLock: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/modules/sync", () => ({ clearAllOfflineVaultData: mocks.clearAllOfflineVaultData, requestLocalVaultLock: mocks.requestLocalVaultLock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));

import { DestructivePersonalVaultResetForm } from "@/modules/vault-management/presentation/destructive-personal-vault-reset-form";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("DestructivePersonalVaultResetForm", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("requires exact confirmation, clears local material, and returns to secure setup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(DestructivePersonalVaultResetForm))));
    expect(container.textContent).toContain("Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus");
    await act(async () => setInputValue(container.querySelector("#destructive-reset-confirmation"), "HAPUS DATA BRANKAS"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Atur ulang Brankas Pribadi?");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Hapus dan atur ulang");
    await act(async () => confirm?.click());

    expect(fetchMock).toHaveBeenCalledWith("/api/personal-vault/destructive-reset", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirmation: "HAPUS DATA BRANKAS" })
    }));
    expect(mocks.clearAllOfflineVaultData).toHaveBeenCalledOnce();
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/vaults");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not call the server when confirmation does not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(DestructivePersonalVaultResetForm))));
    await act(async () => setInputValue(container.querySelector("#destructive-reset-confirmation"), "hapus data brankas"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Frasa konfirmasi tidak cocok");
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected confirmation input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
