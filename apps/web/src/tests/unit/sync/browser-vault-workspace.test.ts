import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptAccountConfiguration: vi.fn(),
  decryptPayloadWithContext: vi.fn(),
  encryptPayloadWithContext: vi.fn(),
  createUserEncryptionIdentity: vi.fn(),
  fetchAuthorizedWorkspaceBundle: vi.fn(),
  migrateUserCryptoProfile: vi.fn(),
  registerUserEncryptionIdentity: vi.fn(),
  serializeEncryptedEnvelope: vi.fn(),
  read: vi.fn(),
  recoverUserRootKeyWithPasskey: vi.fn(),
  recoverOrMigratePrivateKey: vi.fn(),
  recoverUserRootKeyWithRememberedBrowser: vi.fn(),
  replace: vi.fn(),
  unlockPersonalVault: vi.fn(),
  unlockPersonalVaultWithUserRootKey: vi.fn(),
  sharedVaultKey: undefined as Uint8Array | undefined,
}));

vi.mock("@/modules/crypto", () => ({
  browserClientCryptoPort: {},
  browserSha256Digest: { digestSha256: vi.fn() },
  createUserEncryptionIdentity: mocks.createUserEncryptionIdentity,
  decryptPayloadWithContext: mocks.decryptPayloadWithContext,
  encryptPayloadWithContext: mocks.encryptPayloadWithContext,
  deserializeEncryptedEnvelope: vi.fn(() => ({ version: 2, nonce: Uint8Array.of(1), ciphertext: Uint8Array.of(2) })),
  recoverUserRootKeyWithPasskey: mocks.recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser: mocks.recoverUserRootKeyWithRememberedBrowser,
  migrateUserCryptoProfile: mocks.migrateUserCryptoProfile,
  registerUserEncryptionIdentity: mocks.registerUserEncryptionIdentity,
  serializeEncryptedEnvelope: mocks.serializeEncryptedEnvelope,
  unlockPersonalVault: mocks.unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey: mocks.unlockPersonalVaultWithUserRootKey,
}));
vi.mock("@/modules/crypto/migration", () => ({ recover: mocks.recoverOrMigratePrivateKey }));
vi.mock("@/modules/sync", () => ({
  BrowserOfflineVaultRepository: class {
    read = mocks.read;
    replace = mocks.replace;
  },
  fetchAuthorizedWorkspaceBundle: mocks.fetchAuthorizedWorkspaceBundle,
}));
vi.mock("@rhasia-scret/client-vault-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rhasia-scret/client-vault-core")>();
  return {
    ...actual,
    unwrapSharedVaultKeyWithCrypto: vi.fn(async () => mocks.sharedVaultKey ?? new Uint8Array(32).fill(3)),
  };
});
vi.mock("@rhasia-scret/client-vault-core/modules/vault-membership/application/shared-vault-key-wrap-migration", () => ({
  migrateLegacySharedVaultKeyWrapWithCrypto: vi.fn(async () => ({ status: "already-current" as const })),
}));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  decryptAccountConfiguration: mocks.decryptAccountConfiguration,
}));

import {
  AuthorizedWorkspaceTransportError,
  PersonalVaultUnlockError,
  UserEncryptionPrivateKeyRecoveryError,
  VaultWorkspaceUnlockError,
  unwrapSharedVaultKeyWithCrypto,
  type AuthorizedWorkspaceResponse,
} from "@rhasia-scret/client-vault-core";
import { migrateLegacySharedVaultKeyWrapWithCrypto } from "@rhasia-scret/client-vault-core/modules/vault-membership/application/shared-vault-key-wrap-migration";
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
    mocks.sharedVaultKey = undefined;
    vi.stubGlobal("navigator", { onLine: false });
    vi.mocked(migrateLegacySharedVaultKeyWrapWithCrypto).mockResolvedValue({ status: "already-current" });
    vi.mocked(unwrapSharedVaultKeyWithCrypto).mockImplementation(
      async () => mocks.sharedVaultKey ?? new Uint8Array(32).fill(3),
    );
    mocks.decryptPayloadWithContext.mockImplementation(async () => new TextEncoder().encode("Personal Vault"));
  });

  it("classifies authorization, synchronization, storage, and cryptographic unlock failures separately", () => {
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new AuthorizedWorkspaceTransportError(401, "unauthorized"))).toBe(
      "AUTHENTICATION",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new AuthorizedWorkspaceTransportError(503, "unavailable"))).toBe(
      "SYNC",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new LocalStorageSyncError())).toBe("LOCAL_STORAGE");
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("invalid-secret"))).toBe(
      "PASSPHRASE",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("invalid-profile"))).toBe(
      "PROFILE_DATA_INVALID",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("key-derivation"))).toBe(
      "KEY_DERIVATION_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("profile-migration"))).toBe(
      "PROFILE_MIGRATION_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("user-root-key"))).toBe(
      "ROOT_KEY_WRAP_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new PersonalVaultUnlockError("personal-vault-key"))).toBe(
      "PERSONAL_VAULT_KEY_WRAP_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("workspace-response"))).toBe(
      "WORKSPACE_RESPONSE_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("workspace-bundle"))).toBe(
      "WORKSPACE_BUNDLE_INVALID",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("personal-vault-selection"))).toBe(
      "PERSONAL_VAULT_MISMATCH",
    );
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("personal-vault-name-decryption")),
    ).toBe("PERSONAL_VAULT_NAME_DECRYPTION_FAILED");
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("user-encryption-private-key-recovery")),
    ).toBe("USER_ENCRYPTION_KEY_RECOVERY_FAILED");
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new UserEncryptionPrivateKeyRecoveryError("envelope-invalid")),
    ).toBe("USER_ENCRYPTION_ENVELOPE_INVALID");
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new UserEncryptionPrivateKeyRecoveryError("legacy-envelope")),
    ).toBe("USER_ENCRYPTION_LEGACY_ENVELOPE");
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new UserEncryptionPrivateKeyRecoveryError("decryption-failed")),
    ).toBe("USER_ENCRYPTION_KEY_DECRYPTION_FAILED");
    expect(
      classifyBrowserVaultWorkspaceUnlockFailure(new UserEncryptionPrivateKeyRecoveryError("payload-invalid")),
    ).toBe("USER_ENCRYPTION_PRIVATE_KEY_INVALID");
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("crypto-unlock"))).toBe(
      "CRYPTO_UNLOCK_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("vault-content-decryption"))).toBe(
      "VAULT_CONTENT_DECRYPTION_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("profile-rewrap"))).toBe(
      "PROFILE_REWRAP_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new VaultWorkspaceUnlockError("workspace-processing"))).toBe(
      "WORKSPACE_PROCESSING_FAILED",
    );
    expect(classifyBrowserVaultWorkspaceUnlockFailure(new Error("unexpected decrypt failure"))).toBe("UNKNOWN");
  });

  it("tags unexpected online unlock failures by phase without exposing the cause", async () => {
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(workspaceResponse());
    await expect(loadUnlockedVaultWorkspace("secret", "unexpected-vault-id")).rejects.toMatchObject({
      name: "VaultWorkspaceUnlockError",
      stage: "personal-vault-selection",
    });

    mocks.unlockPersonalVault.mockRejectedValue(new Error("synthetic crypto failure"));
    await expect(loadUnlockedVaultWorkspace("secret", "personal-1")).rejects.toMatchObject({
      name: "VaultWorkspaceUnlockError",
      stage: "crypto-unlock",
    });

    mocks.fetchAuthorizedWorkspaceBundle.mockRejectedValue(new Error("synthetic response failure"));
    await expect(loadUnlockedVaultWorkspace("secret", "personal-1")).rejects.toMatchObject({
      name: "VaultWorkspaceUnlockError",
      stage: "workspace-response",
      message: "Vault workspace unlock failed.",
    });

    const response = workspaceResponse();
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    mocks.decryptPayloadWithContext.mockRejectedValue(new Error("synthetic content failure"));

    await expect(loadUnlockedVaultWorkspace("secret", "personal-1")).rejects.toMatchObject({
      name: "VaultWorkspaceUnlockError",
      stage: "personal-vault-name-decryption",
      message: "Vault workspace unlock failed.",
    });

    const responseWithIdentity = workspaceResponse();
    responseWithIdentity.userEncryptionIdentity = {
      publicKey: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) },
      encryptedPrivateKey: "Ag==",
      encryptionVersion: 1,
    };
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(responseWithIdentity);
    mocks.decryptPayloadWithContext.mockResolvedValue(new TextEncoder().encode("Personal Vault"));
    mocks.recoverOrMigratePrivateKey.mockRejectedValue(new Error("synthetic private key failure"));

    await expect(loadUnlockedVaultWorkspace("secret", "personal-1")).rejects.toMatchObject({
      name: "VaultWorkspaceUnlockError",
      stage: "user-encryption-private-key-recovery",
      message: "Vault workspace unlock failed.",
    });
  });

  it("decrypts and persists the Personal-only snapshot while keeping Shared Vault data transient", async () => {
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Personal", "owner"))
      .mockResolvedValueOnce(account("Shared", "member"));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");

    expect(workspace.vaults.map((vault) => vault.type)).toEqual(["PERSONAL", "SHARED"]);
    expect(workspace.accounts).toHaveLength(2);
    expect(mocks.replace).toHaveBeenCalledWith(response.personalSnapshot);
  });

  it("uses an online encrypted User Encryption identity transiently and never persists it offline", async () => {
    const response = workspaceResponse();
    response.userEncryptionIdentity = {
      publicKey: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) },
      encryptedPrivateKey: "Ag==",
      encryptionVersion: 1,
    };
    const userRootKey = Uint8Array.of(1);
    const privateKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43), d: "A".repeat(43) };
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey: Uint8Array.of(2) });
    let recoveredCiphertext: Uint8Array | undefined;
    mocks.recoverOrMigratePrivateKey.mockImplementation(async (_rootKey, ciphertext) => {
      recoveredCiphertext = ciphertext.slice();
      return privateKey;
    });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Personal", "owner"))
      .mockResolvedValueOnce(account("Shared", "member"));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");

    expect(recoveredCiphertext).toEqual(Uint8Array.of(2));
    expect(workspace.vaults[1]).toMatchObject({ id: "shared-1", type: "SHARED", name: "Personal Vault" });
    expect(mocks.replace).toHaveBeenCalledWith(response.personalSnapshot);
    expect(response.personalSnapshot).not.toHaveProperty("userEncryptionIdentity");
    expect(mocks.replace.mock.calls[0]?.[0]).not.toHaveProperty("userEncryptionIdentity");
    expect(privateKey).toMatchObject({ x: "", y: "", d: "" });
  });

  it("enrolls a missing User Encryption identity once and keeps its private-key backup out of offline storage", async () => {
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(1);
    const identityEnvelope = { version: 2 as const, nonce: Uint8Array.of(8), ciphertext: Uint8Array.of(9) };
    const serializedIdentity = Uint8Array.of(5, 6);
    let registeredEncryptedPrivateKey: Uint8Array | undefined;
    const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) };
    mocks.fetchAuthorizedWorkspaceBundle.mockResolvedValue(response);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey: Uint8Array.of(2) });
    mocks.createUserEncryptionIdentity.mockResolvedValue({ publicKey, encryptedPrivateKey: identityEnvelope });
    mocks.serializeEncryptedEnvelope.mockReturnValue(serializedIdentity);
    mocks.registerUserEncryptionIdentity.mockImplementation(async (identity) => {
      registeredEncryptedPrivateKey = identity.encryptedPrivateKey.slice();
      return true;
    });
    mocks.recoverOrMigratePrivateKey.mockResolvedValue({ ...publicKey, d: "A".repeat(43) });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Personal", "owner"))
      .mockResolvedValueOnce(account("Shared", "member"));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");

    expect(registeredEncryptedPrivateKey).toEqual(Uint8Array.of(5, 6));
    expect(identityEnvelope.nonce).toEqual(Uint8Array.of(0));
    expect(identityEnvelope.ciphertext).toEqual(Uint8Array.of(0));
    expect(serializedIdentity).toEqual(Uint8Array.of(0, 0));
    expect(workspace.userEncryptionPublicKey).toEqual(publicKey);
    expect(mocks.replace).toHaveBeenCalledWith(response.personalSnapshot);
    expect(mocks.replace.mock.calls[0]?.[0]).not.toHaveProperty("userEncryptionIdentity");
  });

  it("classifies offline snapshot migration persistence failures as local storage errors", async () => {
    const response = workspaceResponse();
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.read.mockResolvedValue(response.personalSnapshot);
    mocks.unlockPersonalVault.mockResolvedValue({
      userRootKey,
      personalVaultKey,
      migratedProfile: {
        vaultUnlockSalt: Uint8Array.from({ length: 16 }, (_, index) => index),
        wrappedUserRootKey: Uint8Array.of(3),
        encryptedPersonalVaultKey: Uint8Array.of(4),
        encryptionVersion: 1,
      },
    });
    mocks.replace.mockRejectedValue(new Error("synthetic snapshot persistence failure"));

    await expect(loadOfflineVaultWorkspace("profile-1", "secret")).rejects.toBeInstanceOf(LocalStorageSyncError);
    expect(userRootKey).toEqual(Uint8Array.of(0));
    expect(personalVaultKey).toEqual(Uint8Array.of(0));
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
    mocks.sharedVaultKey = sharedVaultKey;
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
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue({ personalVaultKey });
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
    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");
    clearUnlockedVaultWorkspace(workspace);
    expect([...workspace.userRootKey]).toEqual([0]);
    expect([...secret]).toEqual([0]);
  });
});

function account(issuer: string, accountName: string, secret = Uint8Array.of(9)) {
  return { issuer, accountName, secret, algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
}

function workspaceResponse(): AuthorizedWorkspaceResponse {
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
