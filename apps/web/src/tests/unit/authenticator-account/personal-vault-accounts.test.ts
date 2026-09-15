/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  loadUnlockedVaultWorkspace: vi.fn(),
  loadUnlockedVaultWorkspaceWithPasskey: vi.fn(),
  loadUnlockedVaultWorkspaceWithRememberedBrowser: vi.fn(),
  clearUnlockedVaultWorkspace: vi.fn(),
  refreshUnlockedVaultWorkspace: vi.fn(),
  passkeyEnrolled: true,
}));

vi.mock("@/modules/sync/infrastructure/browser-vault-workspace", () => ({
  loadUnlockedVaultWorkspace: mocks.loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey: mocks.loadUnlockedVaultWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser: mocks.loadUnlockedVaultWorkspaceWithRememberedBrowser,
  clearUnlockedVaultWorkspace: mocks.clearUnlockedVaultWorkspace,
  refreshUnlockedVaultWorkspace: mocks.refreshUnlockedVaultWorkspace,
}));
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("@/modules/crypto", () => ({
  PasskeyRecoveryEnrollment: () => null,
  RememberedBrowserEnrollment: () => null,
  hasRememberedBrowserForPersonalVault: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identity")>()),
  usePasskeyRecoveryStatusQuery: () => ({ data: { enrolled: mocks.passkeyEnrolled } }),
}));
vi.mock("@/modules/vault-management", () => ({ recordSharedVaultAccountAccess: vi.fn() }));

import type { UnlockedVaultWorkspace } from "@/modules/sync/infrastructure/browser-vault-workspace";
import { VaultPageAccountMenu } from "@/modules/vault-management/presentation/vault-page-account-menu";
import { PersonalVaultAccounts } from "@/modules/authenticator-account/presentation/personal-vault-accounts";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account/presentation/unlocked-vault-workspace-provider";
import { requestLocalVaultLock } from "@/modules/sync";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("PersonalVaultAccounts", () => {
  let root: Root | undefined;
  beforeEach(() => {
    localStorage.clear();
    mocks.loadUnlockedVaultWorkspace.mockReset();
    mocks.loadUnlockedVaultWorkspaceWithPasskey.mockReset();
    mocks.loadUnlockedVaultWorkspaceWithRememberedBrowser.mockReset();
    mocks.passkeyEnrolled = true;
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("reuses the in-memory Unlocked Vault Session after returning from the add-account page", async () => {
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            { initialWorkspace: workspace() },
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );

    expect(container.querySelector("#vault-unlock-secret")).toBeNull();
    expect(container.textContent).toContain("personal@example.test");
    expect(container.querySelector('a[href="/vaults/manage"] .lucide-vault')).not.toBeNull();
    expect(container.querySelector('a[href="/vaults/manage"] .lucide-lock-keyhole')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Keamanan"]')?.textContent).toContain(
      "Keamanan",
    );
    expect(mocks.loadUnlockedVaultWorkspace).not.toHaveBeenCalled();
  });

  it("preserves an initial workspace through development Strict Mode effect replay", async () => {
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(
            TestQueryProvider,
            null,
            createElement(
              UnlockedVaultWorkspaceProvider,
              { initialWorkspace: workspace() },
              createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
            ),
          ),
        ),
      ),
    );

    expect(container.textContent).toContain("personal@example.test");
    expect(mocks.clearUnlockedVaultWorkspace).not.toHaveBeenCalled();
  });

  it("moves Lock into Account settings above Sign out", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            { initialWorkspace: workspace() },
            createElement(VaultPageAccountMenu, { email: "owner@example.test" }),
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pengaturan akun"]')
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    const lock = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Kunci",
    );
    const signOut = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Keluar",
    );
    expect(lock).toBeDefined();
    expect(signOut).toBeDefined();
    expect(lock && signOut && Boolean(lock.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    await act(async () => lock?.click());
    expect(container.querySelector("#vault-unlock-secret")).not.toBeNull();
    expect(document.body.textContent).not.toContain("owner@example.test");
  });

  it("clears the in-memory workspace when logout or local cleanup requests a global lock", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            { initialWorkspace: workspace() },
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );

    await act(async () => requestLocalVaultLock());

    expect(mocks.clearUnlockedVaultWorkspace).toHaveBeenCalledOnce();
    expect(container.querySelector("#vault-unlock-secret")).not.toBeNull();
  });

  it("opens the same in-memory workspace with an enrolled recovery passkey", async () => {
    mocks.loadUnlockedVaultWorkspaceWithPasskey.mockResolvedValue(workspace());
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            null,
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );

    const passkeyButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Buka dengan passkey"),
    );
    await act(async () => passkeyButton?.click());

    expect(mocks.loadUnlockedVaultWorkspaceWithPasskey).toHaveBeenCalledWith("personal-1");
    expect(container.textContent).toContain("personal@example.test");
    expect(container.querySelector("#vault-unlock-secret")).toBeNull();
  });

  it("does not expose Vault management links from a read-only snapshot", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            { initialWorkspace: workspace() },
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      await act(async () => window.dispatchEvent(new Event("offline")));

      expect(
        container.querySelector('a[aria-label="Buka detail Brankas untuk Example, personal@example.test"]'),
      ).toBeNull();
      expect(container.querySelector('a[aria-label="Buka detail Brankas untuk Work, work@example.test"]')).toBeNull();
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnline });
    }
  });

  it("renders only the aggregated account list with vault provenance and a dedicated add-page link", async () => {
    mocks.loadUnlockedVaultWorkspace.mockResolvedValue(workspace());
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(
            UnlockedVaultWorkspaceProvider,
            null,
            createElement(PersonalVaultAccounts, { vaultId: "personal-1" }),
          ),
        ),
      ),
    );
    const recoveryLink = container.querySelector<HTMLAnchorElement>('a[href="/vaults/recovery"]');
    expect(recoveryLink?.textContent).toBe("Lupa Passphrase Brankas?");
    expect(recoveryLink?.pathname).toBe("/vaults/recovery");
    await act(async () => setInputValue(container.querySelector("#vault-unlock-secret"), "four random secret words"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.querySelectorAll("ul > li article")).toHaveLength(2);
    expect(container.textContent).toContain("personal@example.test");
    expect(container.textContent).toContain("work@example.test");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(container.textContent).toContain("Tim Operasional");
    expect(container.querySelector<HTMLAnchorElement>('a[aria-label="Tambahkan akun autentikator"]')?.pathname).toBe(
      "/vaults/accounts/new",
    );
    expect(container.querySelector('[data-slot="account-directory-menu"]')).not.toBeNull();
    const actionBar = container.querySelector<HTMLElement>('[data-slot="vault-account-actions"]');
    expect(actionBar?.classList.contains("grid")).toBe(true);
    expect(actionBar?.classList.contains("grid-cols-2")).toBe(true);
    expect(actionBar?.classList.contains("sm:grid-cols-4")).toBe(true);
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/vaults/accounts/new"]')?.classList.contains("w-full"),
    ).toBe(true);
    expect(container.querySelector('[data-slot="account-directory-list"]')?.getAttribute("data-view-mode")).toBe(
      "normal",
    );
    const personalVaultMenuTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Kelola personal@example.test"]',
    );
    await act(async () =>
      personalVaultMenuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    const personalVaultLink = [...document.body.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("aria-label") === "Buka detail Brankas untuk Example, personal@example.test",
    );
    expect(personalVaultLink?.pathname).toBe("/vaults/manage/personal");
    await act(async () =>
      personalVaultMenuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    const sharedVaultMenuTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Kelola work@example.test"]',
    );
    await act(async () =>
      sharedVaultMenuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    const sharedVaultLink = [...document.body.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("aria-label") === "Buka detail Brankas untuk Work, work@example.test",
    );
    expect(sharedVaultLink?.pathname).toBe("/vaults/manage/shared-1");
    await act(async () =>
      sharedVaultMenuTrigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    const filterMenu = container.querySelector<HTMLButtonElement>('[data-slot="account-directory-filter-menu"]');
    expect(actionBar?.querySelector('[data-slot="account-directory-filter-menu"]')).toBeNull();
    await act(async () => filterMenu?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    const issuerFilter = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent?.trim() === "Example",
    );
    await act(async () => issuerFilter?.click());
    expect(container.querySelectorAll('[data-slot="account-directory-list"] > li')).toHaveLength(1);
    expect(localStorage.getItem("rhasia-scret:account-directory:v1:profile-1")).not.toContain("Example");
    const allIssuers = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent?.trim() === "Semua penerbit",
    );
    await act(async () => allIssuers?.click());
    await act(async () => filterMenu?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    const directoryMenu = container.querySelector<HTMLButtonElement>('[data-slot="account-directory-menu"]');
    await act(async () => directoryMenu?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    const compactView = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent?.trim() === "Ringkas",
    );
    const normalView = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent?.trim() === "Normal",
    );
    expect(compactView?.querySelector(".lucide-layout-grid")).not.toBeNull();
    expect(normalView?.querySelector(".lucide-list")).not.toBeNull();
    const reorderAction = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Urutkan akun",
    );
    await act(async () => reorderAction?.click());
    const reorderItems = [
      ...document.body.querySelectorAll<HTMLElement>('[data-slot="account-directory-reorder-list"] > li'),
    ];
    expect(reorderItems[0]?.querySelector('button[aria-label*="ke atas"]')).toBeNull();
    expect(reorderItems[0]?.querySelector('button[aria-label*="ke bawah"]')).not.toBeNull();
    expect(reorderItems.at(-1)?.querySelector('button[aria-label*="ke atas"]')).not.toBeNull();
    expect(reorderItems.at(-1)?.querySelector('button[aria-label*="ke bawah"]')).toBeNull();
    const moveDown = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "Pindahkan personal@example.test ke bawah",
    );
    await act(async () => moveDown?.click());
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-account-key]")].map((element) => element.dataset.accountKey),
    ).toEqual(["shared-1:account-2", "personal-1:account-1"]);
    expect(container.querySelector('section > span[aria-live="polite"]')?.textContent).toContain("posisi 2");
    expect(localStorage.getItem("rhasia-scret:account-directory:v1:profile-1")).toContain("shared-1:account-2");
    expect(container.querySelector("#account-uri")).toBeNull();
  });
});

function workspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "sync-1",
    syncState: "CURRENT",
    userRootKey: Uint8Array.of(1),
    vaults: [
      {
        id: "personal-1",
        name: "Brankas Pribadi",
        type: "PERSONAL",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
        },
        key: Uint8Array.of(2),
      },
      {
        id: "shared-1",
        name: "Tim Operasional",
        type: "SHARED",
        role: "VIEWER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
          sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
        },
        key: Uint8Array.of(3),
      },
    ],
    accounts: [
      {
        id: "account-1",
        vaultId: "personal-1",
        vaultName: "Brankas Pribadi",
        vaultType: "PERSONAL",
        revision: 1,
        issuer: "Example",
        accountName: "personal@example.test",
        secret: Uint8Array.of(4),
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
      },
      {
        id: "account-2",
        vaultId: "shared-1",
        vaultName: "Tim Operasional",
        vaultType: "SHARED",
        revision: 1,
        issuer: "Work",
        accountName: "work@example.test",
        secret: Uint8Array.of(5),
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
      },
    ],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
