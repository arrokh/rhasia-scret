/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { VaultArchiveExporter, VaultArchiveExportWorkspace } from "@/modules/vault-archive/presentation/vault-archive-exporter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ recordVaultArchiveExport: vi.fn() }));
vi.mock("@/modules/audit", async (importOriginal) => ({ ...await importOriginal<typeof import("@/modules/audit")>(), recordVaultArchiveExport: mocks.recordVaultArchiveExport }));

const ownerPermissions = { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "OWNER" as const, canEditAccounts: "OWNER" as const, canDeleteAccounts: "OWNER" as const } };
const viewerPermissions = { permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT" as const, canEditAccounts: "VAULT" as const, canDeleteAccounts: "VAULT" as const } };
const workspace = {
  profileId: "profile-1",
  synchronizedAt: "2026-07-27T12:00:00.000Z",
  synchronizationToken: "sync-1",
  syncState: "CURRENT" as const,
  userRootKey: new Uint8Array(32),
  vaults: [
    { id: "personal-1", name: "Personal", type: "PERSONAL" as const, role: "OWNER" as const, effectiveAccountPermissions: ownerPermissions, key: new Uint8Array(32) },
    { id: "shared-viewer", name: "Viewer Vault", type: "SHARED" as const, role: "VIEWER" as const, effectiveAccountPermissions: viewerPermissions, key: new Uint8Array(32) }
  ],
  accounts: [{ id: "account-1", vaultId: "personal-1", vaultName: "Personal", vaultType: "PERSONAL" as const, revision: 1, issuer: "Example", accountName: "alice@example.test", secret: new Uint8Array([1, 2, 3]), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 }],
  unavailableAccounts: [],
  unavailableSharedVaults: 0
};

describe("VaultArchiveExporter", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("excludes Viewer Vaults and releases archive/key only after audit succeeds", async () => {
    let finishAudit: (() => void) | undefined;
    mocks.recordVaultArchiveExport.mockImplementation(() => new Promise<void>((resolve) => { finishAudit = resolve; }));
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(VaultArchiveExporter, { workspace })));
    expect(container.textContent).not.toContain("Viewer Vault");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    await act(async () => findButton(container, "Buat cadangan").click());
    await vi.waitFor(() => expect(mocks.recordVaultArchiveExport).toHaveBeenCalledWith("personal-1"));
    expect(container.textContent).not.toContain("Unduh arsip");
    await act(async () => finishAudit?.());
    await vi.waitFor(() => expect(container.textContent).toContain("Unduh arsip"));
    expect(container.querySelector<HTMLInputElement>("#generated-archive-key")?.value).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("blocks stale workspaces before preparing or auditing an archive", async () => {
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: { ...workspace, syncState: "STALE" } }, createElement(VaultArchiveExportWorkspace, { personalVaultId: "personal-1" }))));
    expect(container.textContent).toContain("Cadangan diblokir sampai sinkronisasi dan otorisasi kembali terkini.");
    expect(mocks.recordVaultArchiveExport).not.toHaveBeenCalled();
  });

  it("does not release archive/key when audit recording fails", async () => {
    mocks.recordVaultArchiveExport.mockRejectedValue(new Error("Audit unavailable"));
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(VaultArchiveExporter, { workspace })));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    await act(async () => {
      findButton(container, "Buat cadangan").click();
      await vi.waitFor(() => expect(container.textContent).toContain("Cadangan terenkripsi tidak dapat dibuat atau dicatat dalam audit."));
    });
    expect(container.textContent).not.toContain("Unduh arsip");
    expect(container.querySelector("#generated-archive-key")).toBeNull();
  });
});

function mount() { const container = document.createElement("div"); document.body.append(container); return container; }
function findButton(container: ParentNode, name: string): HTMLButtonElement { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "")); if (!button) throw new Error(`Expected button: ${name}`); return button; }
