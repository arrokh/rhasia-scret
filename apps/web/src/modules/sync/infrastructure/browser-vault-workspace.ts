"use client";

import {
  createUserEncryptionIdentity,
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser,
  recoverUserEncryptionPrivateKey,
  registerUserEncryptionIdentity,
  rewrapUserCryptoProfile,
  serializeEncryptedEnvelope,
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey,
} from "@/modules/crypto";
import { decryptAccountConfiguration } from "@/modules/authenticator-account/client";
import { BrowserOfflineVaultRepository, fetchAuthorizedWorkspaceBundle } from "@/modules/sync";
import { browserNetworkStatus } from "@/shared/infrastructure/browser-platform-ports";
import { unlockSharedVault } from "@/modules/vault-membership";
import type { CancellationPort } from "@rhasia-scret/client-vault-core";
import {
  AuthorizedWorkspaceTransportError,
  clearUnlockedVaultWorkspace,
  evictSharedVaultWorkspace,
  loadOfflineVaultWorkspace as loadOfflineWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser as loadOfflineWorkspaceWithRememberedBrowser,
  loadUnlockedVaultWorkspace as loadUnlockedWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey as loadUnlockedWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser as loadUnlockedWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace as refreshWorkspace,
  LocalStorageSyncError,
  PersonalVaultUnlockError,
  type UnlockedVaultWorkspace,
  type WorkspaceAuthenticatorAccount,
} from "@rhasia-scret/client-vault-core";
import type { VaultWorkspacePlatformPorts } from "@rhasia-scret/client-vault-core";

export { clearUnlockedVaultWorkspace, evictSharedVaultWorkspace, LocalStorageSyncError };
export type { UnlockedVaultWorkspace, WorkspaceAuthenticatorAccount };

export type BrowserVaultWorkspaceUnlockFailure =
  | "AUTHENTICATION"
  | "LOCAL_STORAGE"
  | "KEY_DERIVATION_FAILED"
  | "PASSPHRASE"
  | "PERSONAL_VAULT_KEY_WRAP_FAILED"
  | "PROFILE_DATA_INVALID"
  | "PROFILE_MIGRATION_FAILED"
  | "ROOT_KEY_WRAP_FAILED"
  | "SYNC"
  | "UNKNOWN";

export function classifyBrowserVaultWorkspaceUnlockFailure(error: unknown): BrowserVaultWorkspaceUnlockFailure {
  if (error instanceof AuthorizedWorkspaceTransportError)
    return error.status === 401 || (error.status === 403 && error.code === "inactive_user") ? "AUTHENTICATION" : "SYNC";
  if (error instanceof LocalStorageSyncError) return "LOCAL_STORAGE";
  if (error instanceof PersonalVaultUnlockError) {
    if (error.stage === "invalid-secret") return "PASSPHRASE";
    if (error.stage === "invalid-profile") return "PROFILE_DATA_INVALID";
    if (error.stage === "key-derivation") return "KEY_DERIVATION_FAILED";
    if (error.stage === "user-root-key") return "ROOT_KEY_WRAP_FAILED";
    if (error.stage === "personal-vault-key") return "PERSONAL_VAULT_KEY_WRAP_FAILED";
    if (error.stage === "profile-migration") return "PROFILE_MIGRATION_FAILED";
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function browserPorts(): VaultWorkspacePlatformPorts {
  const snapshotStore = new BrowserOfflineVaultRepository();
  return {
    network: browserNetworkStatus,
    data: {
      snapshotStore,
      fetchAuthorizedWorkspaceBundle: (signal) => fetchAuthorizedWorkspaceBundle(signal),
      registerUserEncryptionIdentity: (identity, signal) => registerUserEncryptionIdentity(identity, signal),
    },
    crypto: {
      unlockPersonalVault,
      unlockPersonalVaultWithUserRootKey,
      recoverUserRootKeyWithRememberedBrowser: (profileId, ...signals) =>
        signals.length
          ? recoverUserRootKeyWithRememberedBrowser(profileId, signals[0] as AbortSignal | undefined)
          : recoverUserRootKeyWithRememberedBrowser(profileId),
      recoverUserRootKeyWithPasskey,
      rewrapUserCryptoProfile,
      decryptPayload: async (key, envelope) => {
        const cryptoPort = await import("@/modules/crypto");
        if (!cryptoPort.decryptPayload) throw new Error("Legacy payload decryption is unavailable.");
        return cryptoPort.decryptPayload(key, envelope);
      },
      decryptPayloadWithContext,
      deserializeEncryptedEnvelope,
      recoverUserEncryptionPrivateKey: (userRootKey, encryptedPrivateKey) =>
        recoverUserEncryptionPrivateKey(userRootKey, deserializeEncryptedEnvelope(encryptedPrivateKey)),
      createUserEncryptionIdentity,
      serializeEncryptedEnvelope,
      unlockSharedVault,
      decryptAccountConfiguration,
    },
  };
}

export function loadUnlockedVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string,
): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspace(vaultUnlockSecret, personalVaultId, browserPorts());
}

export function loadUnlockedVaultWorkspaceWithRememberedBrowser(
  personalVaultId: string,
  signal?: AbortSignal,
): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspaceWithRememberedBrowser(
    personalVaultId,
    browserPorts(),
    signal as CancellationPort | undefined,
  );
}

export function loadUnlockedVaultWorkspaceWithPasskey(personalVaultId: string): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspaceWithPasskey(personalVaultId, browserPorts());
}

export function loadOfflineVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string,
): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspace(profileId, vaultUnlockSecret, browserPorts());
}

export function loadOfflineVaultWorkspaceWithRememberedBrowser(profileId: string): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspaceWithRememberedBrowser(profileId, browserPorts());
}

export function refreshUnlockedVaultWorkspace(
  userRootKey: Uint8Array,
  expectedProfileId: string,
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(userRootKey, expectedProfileId, browserPorts(), signal);
}
