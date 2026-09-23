/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  clearWorkspace: vi.fn(),
  listProfiles: vi.fn(),
  loadOffline: vi.fn(),
  loadRemembered: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/modules/sync/infrastructure/browser-vault-workspace", () => ({
  clearUnlockedVaultWorkspace: mocks.clearWorkspace,
  evictSharedVaultWorkspace: (workspace: unknown) => workspace,
  loadOfflineVaultWorkspace: mocks.loadOffline,
  loadOfflineVaultWorkspaceWithRememberedBrowser: mocks.loadRemembered,
  refreshUnlockedVaultWorkspace: mocks.refresh,
}));
vi.mock("@/modules/sync/infrastructure/browser-offline-vault-repository", () => ({
  BrowserOfflineVaultRepository: class {
    clearAll = mocks.clear;
    listProfiles = mocks.listProfiles;
  },
}));
import { OfflineVaultShell } from "@/modules/sync/presentation/offline-vault-shell";

describe("OfflineVaultShell", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("links an empty offline state back to sign in", async () => {
    mocks.listProfiles.mockResolvedValue({ profiles: [], migrationRequired: false });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(OfflineVaultShell)));

    expect(container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]')?.textContent).toContain("Kembali ke masuk");
  });

  it("shows reconnect guidance after legacy Shared Vault snapshot cleanup", async () => {
    mocks.listProfiles.mockResolvedValue({ profiles: [], migrationRequired: true });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(OfflineVaultShell)));

    expect(container.textContent).toContain("Snapshot lama yang berisi Brankas Bersama telah dihapus");
  });

  it("unlocks a Personal-only snapshot read-only and exposes no mutation affordances", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    mocks.listProfiles.mockResolvedValue({
      profiles: [
        {
          profileId: "profile_1",
          personalVaultId: "personal_1",
          synchronizedAt: "2026-01-01T00:00:00.000Z",
          sharedVaultCount: 0,
        },
      ],
      migrationRequired: false,
    });
    mocks.loadOffline.mockResolvedValue(workspace());
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(OfflineVaultShell)));
    await act(async () => setInputValue(container.querySelector("#offline-secret"), "vault secret"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.textContent).toContain("personal@example.test");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(container.textContent).not.toContain("owner@example.test");
    expect(container.textContent).not.toContain("Tim Owner");
    expect(container.textContent).not.toContain("viewer@example.test");
    expect(container.textContent).not.toContain("Tim Viewer");
    expect(container.textContent).toContain("pemeriksaan drift dan audit akses tidak tersedia");
    expect(container.querySelector('header a[href="/sign-in"]')?.textContent).toContain("Kembali ke masuk");
    expect(container.querySelector('button[aria-label^="Kelola"]')).toBeNull();
    expect(container.querySelector('a[href="/vaults/accounts/new"]')).toBeNull();
    expect(container.textContent).not.toContain("Tambah akun");
  });
});

function workspace() {
  return {
    profileId: "profile_1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "sync_1",
    syncState: "OFFLINE" as const,
    userRootKey: Uint8Array.of(1),
    unavailableSharedVaults: 0,
    vaults: [
      {
        id: "personal_1",
        name: "Brankas Pribadi",
        type: "PERSONAL" as const,
        role: "OWNER" as const,
        key: Uint8Array.of(2),
      },
    ],
    accounts: [account("personal", "personal_1", "Brankas Pribadi", "PERSONAL" as const)],
  };
}

function account(name: string, vaultId: string, vaultName: string, vaultType: "PERSONAL" | "SHARED") {
  return {
    id: `${name}_account`,
    vaultId,
    vaultName,
    vaultType,
    revision: 1,
    issuer: "Example",
    accountName: `${name}@example.test`,
    secret: Uint8Array.of(5),
    algorithm: "SHA-1" as const,
    digits: 6 as const,
    period: 30,
  };
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
