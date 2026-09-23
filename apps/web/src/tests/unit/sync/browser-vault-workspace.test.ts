import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptAccountConfiguration: vi.fn(),
  decryptPayloadWithContext: vi.fn(),
  fetchAuthorizedWorkspaceBundle: vi.fn(),
  read: vi.fn(),
  recoverUserRootKeyWithPasskey: vi.fn(),
  recoverUserRootKeyWithRememberedBrowser: vi.fn(),
  rewrapUserCryptoProfile: vi.fn(),
  replace: vi.fn(),
  unlockPersonalVault: vi.fn(),
  unlockPersonalVaultWithUserRootKey: vi.fn(),
  unlockSharedVault: vi.fn(),
}));

vi.mock("@/modules/crypto", () => ({
  decryptPayloadWithContext: mocks.decryptPayloadWithContext,
  deserializeEncryptedEnvelope: vi.fn((value) => value),
  recoverUserRootKeyWithPasskey: mocks.recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser: mocks.recoverUserRootKeyWithRememberedBrowser,
  rewrapUserCryptoProfile: mocks.rewrapUserCryptoProfile,
  unlockPersonalVault: mocks.unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey: mocks.unlockPersonalVaultWithUserRootKey,
}));
vi.mock("@/modules/sync", () => ({
  BrowserOfflineVaultRepository: class {
    read = mocks.read;
    replace = mocks.replace;
  },
  fetchAuthorizedWorkspaceBundle: mocks.fetchAuthorizedWorkspaceBundle,
}));
vi.mock("@/modules/vault-membership", () => ({ unlockSharedVault: mocks.unlockSharedVault }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  decryptAccountConfiguration: mocks.decryptAccountConfiguration,
}));

import { AuthorizedWorkspaceTransportError } from "@rhasia-scret/client-vault-core";
import {
  classifyBrowserVaultWorkspaceUnlockFailure,
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace,
  loadUnlockedVaultWorkspace,
  LocalStorageSyncError,
  refreshUnlockedVaultWorkspace,
} from "@/modules/sync/infrastructure/browser-vault-workspace";

describe("Vault workspace loading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("navigator", { onLine: false });
    mocks.decryptPayloadWithContext.mockResolvedValue(new TextEncoder().encode("Personal Vault"));
  });

  it("classifies authorization, synchronization, storage, and passphrase failures separately", () => {
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new AuthorizedWorkspaceTransportError(401, "unauthorized"))).toBe(
      "AUTHENTICATION",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new AuthorizedWorkspaceTransportError(503, "unavailable"))).toBe(
      "SYNC",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new LocalStorageSyncError())).toBe("LOCAL_STORAGE");
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new Error("invalid passphrase"))).toBe("PASSPHRASE");
  });

  it("decrypts and persists the Personal-only snapshot while keeping Shared Vault data transient", async () => {
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey });
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: Uint8Array.of(3), name: "Team" });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Personal", "owner"))
      .mockResolvedValueOnce(account("Shared", "member"));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");

    expect(workspace.vaults.map((vault) => vault.type)).toEqual(["PERSONAL", "SHARED"]);
    expect(workspace.accounts).toHaveLength(2);
    expect(mocks.replace).toHaveBeenCalledWith(response.personalSnapshot);
  });

  it("loads the Personal-only snapshot offline without contacting the workspace transport", async () => {
    const response = workspaceResponse();
    mocks.read.mockResolvedValue(response.personalSnapshot);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    const workspace = await loadOfflineVaultWorkspace("profile-1", "secret");
    expect(workspace.syncState).toBe("OFFLINE");
    expect(mocks.fetchAuthorizedWorkspaceBundle).not.toHaveBeenCalled();
  });

  it("rejects reconciliation for a different authenticated profile and clears the copied key", async () => {
    const response = workspaceResponse();
    response.personalSnapshot.profileId = "profile-2";
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    const userRootKey = Uint8Array.of(7);
    await expect(refreshUnlockedVaultWorkspace(userRootKey, "profile-1")).rejects.toThrow(/does not match/);
    expect([...userRootKey]).toEqual([7]);
  });

  it("aborts refresh before decrypting or persisting when the workspace is locked in flight", async () => {
    let aborted = false;
    const listeners = new Set<() => void>();
    const signal = {
      get aborted() {
        return aborted;
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(7);
    mocks.fetchAuthorizedWorkspaceBundle.mockImplementation(async () => {
      aborted = true;
      for (const listener of listeners) listener();
      return response;
    });

    await expect(refreshUnlockedVaultWorkspace(userRootKey, "profile-1", signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mocks.fetchAuthorizedWorkspaceBundle).toHaveBeenCalledWith(signal);
    expect(mocks.unlockPersonalVaultWithUserRootKey).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(userRootKey).toEqual(Uint8Array.of(7));
  });

  it("zeroes keys immediately and late decrypted account material when cancellation occurs", async () => {
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    const sharedVaultKey = Uint8Array.of(3);
    const personalSecret = Uint8Array.of(18);
    const lateSecret = Uint8Array.of(19);
    let resolveSharedAccount: ((value: ReturnType<typeof account>) => void) | undefined;
    let cancelled = false;
    const listeners = new Set<() => void>();
    const signal = {
      get aborted() {
        return cancelled;
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue(personalVaultKey);
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: sharedVaultKey, name: "Team" });
    mocks.decryptAccountConfiguration.mockImplementation(async (key) => {
      if (key === sharedVaultKey) return new Promise((resolve) => (resolveSharedAccount = resolve));
      return account("Personal", "owner", personalSecret);
    });
    const pending = refreshUnlockedVaultWorkspace(userRootKey, "profile-1", signal);
    await vi.waitFor(() => expect(mocks.decryptAccountConfiguration).toHaveBeenCalledTimes(2));

    cancelled = true;
    for (const listener of listeners) listener();
    expect(personalVaultKey).toEqual(Uint8Array.of(0));
    expect(sharedVaultKey).toEqual(Uint8Array.of(0));
    resolveSharedAccount?.(account("Shared", "member", lateSecret));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(personalSecret).toEqual(Uint8Array.of(0));
    expect(lateSecret).toEqual(Uint8Array.of(0));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("clears personal and transient Shared key material when the workspace is locked", async () => {
    const response = workspaceResponse();
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    const secret = Uint8Array.of(9);
    mocks.decryptAccountConfiguration.mockResolvedValue(account("Issuer", "account", secret));
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: Uint8Array.of(3), name: "Team" });
    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");
    clearUnlockedVaultWorkspace(workspace);
    expect([...workspace.userRootKey]).toEqual([0]);
    expect([...secret]).toEqual([0]);
  });
});

function account(issuer: string, accountName: string, secret = Uint8Array.of(9)) {
  return { issuer, accountName, secret, algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
}

function workspaceResponse() {
  const encrypted = "BQ==";
  return {
    responseVersion: 1 as const,
    workspaceSynchronizationToken: "sync-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    personalSnapshot: {
      schemaVersion: 3 as const,
      profileId: "profile-1",
      synchronizedAt: "2026-01-01T00:00:00.000Z",
      synchronizationToken: "personal-sync-1",
      cryptoProfile: {
        vaultUnlockSalt: "AQ==",
        wrappedUserRootKey: "Ag==",
        encryptedPersonalVaultKey: "Aw==",
        encryptionVersion: 1 as const,
      },
      personalVault: {
        vaultId: "personal-1",
        lifecycle: "ACTIVE" as const,
        encryptedName: encrypted,
        encryptionVersion: 1 as const,
        accounts: [{ id: "personal-account", encryptedPayload: encrypted, encryptionVersion: 1 as const, revision: 1 }],
      },
    },
    sharedVaults: [
      {
        vaultId: "shared-1",
        lifecycle: "ACTIVE" as const,
        role: "VIEWER" as const,
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
          sources: {
            canAddAccounts: "VAULT" as const,
            canEditAccounts: "VAULT" as const,
            canDeleteAccounts: "VAULT" as const,
          },
        },
        encryptedName: encrypted,
        encryptionVersion: 1 as const,
        encryptedVaultKey: encrypted,
        keyVersion: 1,
        accounts: [{ id: "shared-account", encryptedPayload: encrypted, encryptionVersion: 1 as const, revision: 1 }],
      },
    ],
  };
}
