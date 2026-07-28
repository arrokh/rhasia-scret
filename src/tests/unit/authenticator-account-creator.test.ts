/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  encryptAccountConfiguration: vi.fn(),
  isDuplicateAccount: vi.fn(),
  loadUnlockedVaultWorkspace: vi.fn(),
  clearUnlockedVaultWorkspace: vi.fn(),
  refreshUnlockedVaultWorkspace: vi.fn(),
  parseTotpUri: vi.fn(),
  qrOnUri: undefined as undefined | ((uri: string) => void),
  push: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/modules/otp-runtime", () => ({ parseTotpUri: mocks.parseTotpUri }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  encryptAccountConfiguration: mocks.encryptAccountConfiguration,
  isDuplicateAccount: mocks.isDuplicateAccount
}));
vi.mock("@/modules/authenticator-account/infrastructure/browser-vault-workspace", () => ({
  loadUnlockedVaultWorkspace: mocks.loadUnlockedVaultWorkspace,
  clearUnlockedVaultWorkspace: mocks.clearUnlockedVaultWorkspace,
  refreshUnlockedVaultWorkspace: mocks.refreshUnlockedVaultWorkspace
}));
vi.mock("@/modules/authenticator-account/presentation/qr-import-input", () => ({ QrImportInput: ({ onUri }: { onUri: (uri: string) => void }) => { mocks.qrOnUri = onUri; return null; } }));

import { AuthenticatorAccountCreator } from "@/modules/authenticator-account/presentation/authenticator-account-creator";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account/presentation/unlocked-vault-workspace-provider";
import { TestQueryProvider } from "@/tests/test-query-provider";

const ownerPermissions = { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "OWNER" as const, canEditAccounts: "OWNER" as const, canDeleteAccounts: "OWNER" as const } };

describe("AuthenticatorAccountCreator", () => {
  let root: Root | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
  });

  it("preselects the Shared Vault requested from its management modal", async () => {
    const sessionWorkspace = {
      profileId: "profile-1",
      synchronizedAt: "2026-01-01T00:00:00.000Z",
      synchronizationToken: "sync-1",
      syncState: "CURRENT" as const,
      userRootKey: new Uint8Array(32),
      vaults: [
        { id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL" as const, role: "OWNER" as const, effectiveAccountPermissions: ownerPermissions, key: new Uint8Array(32) },
        { id: "shared-1", name: "Tim Operasional", type: "SHARED" as const, role: "OWNER" as const, effectiveAccountPermissions: ownerPermissions, key: new Uint8Array(32) }
      ],
      accounts: [],
      unavailableAccounts: [],
      unavailableSharedVaults: 0
    };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(TestQueryProvider, null,
      createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: sessionWorkspace },
        createElement(AuthenticatorAccountCreator, { personalVaultId: "personal-1", preferredVaultId: "shared-1" })
      )
    )));

    expect(container.querySelector("#account-target-vault")?.textContent).toContain("Tim Operasional");
    expect(container.querySelector("#account-vault-unlock-secret")).toBeNull();
  });

  it("unlocks, selects an owned Shared Vault, encrypts locally, and posts from the dedicated page", async () => {
    const candidate = { issuer: "Example", accountName: "person@example.test", secret: Uint8Array.of(1), algorithm: "SHA-1", digits: 6, period: 30 };
    const sharedKey = Uint8Array.of(8);
    mocks.loadUnlockedVaultWorkspace.mockResolvedValue({
      profileId: "profile-1",
      synchronizedAt: "2026-01-01T00:00:00.000Z",
      synchronizationToken: "sync-1",
      syncState: "CURRENT",
      userRootKey: Uint8Array.of(7),
      vaults: [
        { id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", effectiveAccountPermissions: ownerPermissions, key: Uint8Array.of(6) },
        { id: "shared-1", name: "Tim Operasional", type: "SHARED", role: "OWNER", effectiveAccountPermissions: ownerPermissions, key: sharedKey }
      ],
      accounts: [],
      unavailableAccounts: []
    });
    mocks.parseTotpUri.mockReturnValue(candidate);
    mocks.isDuplicateAccount.mockReturnValue(false);
    mocks.encryptAccountConfiguration.mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new-account", revision: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null,
      createElement(UnlockedVaultWorkspaceProvider, null, createElement(AuthenticatorAccountCreator, { personalVaultId: "personal-1", preferredVaultId: "shared-1" }))
    )));

    await act(async () => {
      setInputValue(container.querySelector("#account-vault-unlock-secret"), "four random secret words");
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.querySelector("#account-target-vault")?.textContent).toContain("Tim Operasional");
    await act(async () => mocks.qrOnUri?.("otpauth://totp/Example:person@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example"));
    expect(container.querySelector<HTMLInputElement>("#account-uri")?.readOnly).toBe(true);
    expect(container.textContent).toContain("Metadata autentikator");
    expect(container.textContent).toContain("SHA-1");
    expect(container.textContent).toContain("30 detik");
    expect(container.querySelector<HTMLInputElement>("#account-label")?.value).toBe("person@example.test");
    await act(async () => setInputValue(container.querySelector("#account-label"), "Alice Mobile"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.encryptAccountConfiguration).toHaveBeenCalledWith(sharedKey, { ...candidate, accountName: "Alice Mobile" });
    expect(fetchMock).toHaveBeenCalledWith("/api/shared-vaults/shared-1/accounts", expect.objectContaining({ method: "POST" }));
    expect(mocks.push).toHaveBeenCalledWith("/vaults");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
