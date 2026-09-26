/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyBrowserVaultWorkspaceUnlockFailure: vi.fn(),
  loadUnlockedVaultWorkspace: vi.fn(),
  captureAnalyticsEvent: vi.fn(),
}));

vi.mock("@/modules/crypto", () => ({ hasRememberedBrowserForPersonalVault: vi.fn().mockResolvedValue(false) }));
vi.mock("@/modules/identity", () => ({ usePasskeyRecoveryStatusQuery: () => ({ data: { enrolled: false } }) }));
vi.mock("@/modules/sync", () => ({
  classifyBrowserVaultWorkspaceUnlockFailure: mocks.classifyBrowserVaultWorkspaceUnlockFailure,
  clearUnlockedVaultWorkspace: vi.fn(),
  loadUnlockedVaultWorkspace: mocks.loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey: vi.fn(),
  loadUnlockedVaultWorkspaceWithRememberedBrowser: vi.fn(),
}));
vi.mock("@/shared/infrastructure/browser-analytics", () => ({ captureAnalyticsEvent: mocks.captureAnalyticsEvent }));

import { VaultWorkspaceUnlock } from "@/modules/authenticator-account/presentation/vault-workspace-unlock";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("locked Vault session", () => {
  it("shows a sign-in action when the session expires before the encrypted bundle is loaded", async () => {
    mocks.classifyBrowserVaultWorkspaceUnlockFailure.mockReturnValue("AUTHENTICATION");
    mocks.loadUnlockedVaultWorkspace.mockRejectedValueOnce(new Error("session expired"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(createElement(VaultWorkspaceUnlock, { personalVaultId: "vault_test123", onUnlocked: vi.fn() })),
    );
    const input = container.querySelector<HTMLInputElement>("#vault-unlock-secret");
    await act(async () => setInputValue(input, "correct passphrase"));
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sesi masuk Anda telah berakhir");
    const signInLink = [...container.querySelectorAll("a")].find((link) => link.textContent === "Masuk lagi");
    expect(signInLink?.getAttribute("href")).toBe("/sign-in?auth=required&next=%2Fvaults");
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("Passphrase Brankas tidak dapat");
  });

  it("offers contextual help without replacing the entered Vault Passphrase", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(createElement(VaultWorkspaceUnlock, { personalVaultId: "vault_test123", onUnlocked: vi.fn() })),
    );
    const passphrase = container.querySelector<HTMLInputElement>("#vault-unlock-secret");
    await act(async () => setInputValue(passphrase, "synthetic passphrase"));
    await import("@/shared/presentation/contextual-help-dialog");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Buka panduan: Membuka sesi Brankas"]')?.click();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Membuka sesi Brankas");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(passphrase?.value).toBe("synthetic passphrase");
  });

  it("offers the independent Local Vault as a separate touchpoint", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(createElement(VaultWorkspaceUnlock, { personalVaultId: "vault_test123", onUnlocked: vi.fn() })),
    );

    const link = [...container.querySelectorAll("a")].find(
      (candidate) => candidate.textContent === "Buka Brankas Lokal",
    );
    expect(container.textContent).toContain("Brankas Anda terkunci");
    expect(container.textContent).toContain("Brankas Lokal independen");
    expect(link?.getAttribute("href")).toBe("/local");
  });
});

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error("Expected Vault Passphrase input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
