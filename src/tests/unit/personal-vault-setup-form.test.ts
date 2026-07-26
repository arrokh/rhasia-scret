/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const cryptoMocks = vi.hoisted(() => ({
  generateVaultUnlockSecret: vi.fn(),
  initializePersonalVaultInBrowser: vi.fn(),
  validateVaultUnlockSecret: vi.fn((secret: string) => {
    if (secret.trim().length < 3) throw new Error("At least three characters are required.");
  })
}));
const navigationMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/modules/crypto", () => cryptoMocks);
vi.mock("next/navigation", () => ({ useRouter: () => navigationMocks }));

import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("PersonalVaultSetupForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not render a random Vault Unlock Secret until the client has hydrated", async () => {
    cryptoMocks.generateVaultUnlockSecret.mockReset();
    cryptoMocks.generateVaultUnlockSecret
      .mockReturnValueOnce("picnic trophy sheriff coin wire ocean")
      .mockReturnValueOnce("canvas rabbit antenna volcano winter velvet");
    const recoverableErrors: unknown[] = [];
    const container = document.createElement("div");
    const form = createElement(StrictMode, null, createElement(TestQueryProvider, null, createElement(PersonalVaultSetupForm)));
    container.innerHTML = renderToString(form);

    expect(cryptoMocks.generateVaultUnlockSecret).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe("Membuat passphrase…");

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, form, {
        onRecoverableError: (error) => recoverableErrors.push(error)
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(cryptoMocks.generateVaultUnlockSecret).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("picnic trophy sheriff coin wire ocean");

    const regenerate = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Buat passphrase lain"));
    await act(async () => regenerate?.click());

    expect(cryptoMocks.generateVaultUnlockSecret).toHaveBeenCalledTimes(2);
    expect(container.querySelector("output")?.textContent).toBe("canvas rabbit antenna volcano winter velvet");

    await act(async () => root?.unmount());
  });

  it("lets the user choose and submit their own Passphrase Brankas", async () => {
    cryptoMocks.generateVaultUnlockSecret.mockReset();
    cryptoMocks.generateVaultUnlockSecret.mockReturnValue("picnic trophy sheriff coin wire ocean");
    cryptoMocks.initializePersonalVaultInBrowser.mockReset();
    cryptoMocks.initializePersonalVaultInBrowser.mockResolvedValue({
      vaultUnlockSalt: new Uint8Array(16),
      wrappedUserRootKey: new Uint8Array(13),
      encryptedPersonalVaultKey: new Uint8Array(13),
      encryptedVaultName: new Uint8Array(13),
      encryptionVersion: 1
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(TestQueryProvider, null, createElement(PersonalVaultSetupForm)));
    });

    const customMode = container.querySelector<HTMLButtonElement>("#custom-secret");
    await act(async () => customMode?.click());

    expect(container.querySelector("output")).toBeNull();
    expect(container.textContent).toContain("minimal 3 karakter");

    const form = container.querySelector<HTMLFormElement>("form");
    const customSecret = container.querySelector<HTMLInputElement>("#custom-unlock-secret");
    const confirmation = container.querySelector<HTMLInputElement>("#unlock-secret-confirmation");
    const acknowledgement = container.querySelector<HTMLButtonElement>('[role="checkbox"]');
    const showCustomSecret = container.querySelector<HTMLButtonElement>('[aria-label="Tampilkan Passphrase Brankas Anda"]');
    const showConfirmation = container.querySelector<HTMLButtonElement>('[aria-label="Tampilkan Konfirmasi Passphrase Brankas"]');

    expect(customSecret?.type).toBe("password");
    expect(confirmation?.type).toBe("password");
    await act(async () => {
      showCustomSecret?.click();
      showConfirmation?.click();
    });
    expect(customSecret?.type).toBe("text");
    expect(confirmation?.type).toBe("text");
    expect(container.querySelector('[aria-label="Sembunyikan Passphrase Brankas Anda"]')).not.toBeNull();

    await act(async () => {
      setInputValue(customSecret, "abc");
      setInputValue(confirmation, "abd");
    });
    expect(confirmation?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("tidak cocok dengan Passphrase Brankas Anda");

    await act(async () => {
      setInputValue(customSecret, "ab");
      setInputValue(confirmation, "ab");
      acknowledgement?.click();
    });
    await act(async () => form?.requestSubmit());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("minimal 3 karakter");
    expect(confirmation?.getAttribute("aria-invalid")).toBe("false");
    expect(cryptoMocks.initializePersonalVaultInBrowser).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(customSecret, "abc");
      setInputValue(confirmation, "abc");
    });
    await act(async () => form?.requestSubmit());

    expect(cryptoMocks.initializePersonalVaultInBrowser).toHaveBeenCalledWith(
      "abc",
      "Brankas Pribadi"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/personal-vault/initialize", expect.objectContaining({ method: "POST" }));
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => root?.unmount());
  });

  it("lets TanStack Form explain missing confirmation or acknowledgement instead of silently disabling submit", async () => {
    cryptoMocks.generateVaultUnlockSecret.mockReset();
    cryptoMocks.generateVaultUnlockSecret.mockReturnValue("picnic trophy sheriff coin wire ocean");
    cryptoMocks.initializePersonalVaultInBrowser.mockResolvedValue({
      vaultUnlockSalt: new Uint8Array(16),
      wrappedUserRootKey: new Uint8Array(13),
      encryptedPersonalVaultKey: new Uint8Array(13),
      encryptedVaultName: new Uint8Array(13),
      encryptionVersion: 1
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(TestQueryProvider, null, createElement(PersonalVaultSetupForm)));
    });

    const form = container.querySelector<HTMLFormElement>("form");
    const confirmation = container.querySelector<HTMLInputElement>("#unlock-secret-confirmation");
    const acknowledgement = container.querySelector<HTMLButtonElement>('[role="checkbox"]');
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(submit?.disabled).toBe(false);
    expect(form?.checkValidity()).toBe(false);

    await act(async () => {
      setInputValue(confirmation, "picnic trophy sheriff coin wire ocean");
      acknowledgement?.click();
    });
    await act(async () => form?.requestSubmit());

    expect(cryptoMocks.initializePersonalVaultInBrowser).toHaveBeenCalledWith(
      "picnic trophy sheriff coin wire ocean",
      "Brankas Pribadi"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/personal-vault/initialize", expect.objectContaining({ method: "POST" }));
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => root?.unmount());
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected the confirmation input.");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
