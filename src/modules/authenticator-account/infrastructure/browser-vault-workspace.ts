"use client";

import {
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser,
  rewrapUserCryptoProfile,
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey
} from "@/modules/crypto";
import { decryptAccountConfiguration } from "./browser-account-payload";
import { BrowserOfflineVaultRepository, fetchAuthorizedOfflineBundle } from "@/modules/sync";
import { browserNetworkStatus } from "@/shared/infrastructure/browser-platform-ports";
import { unlockSharedVault } from "@/modules/vault-membership";
import type { CancellationPort } from "@/shared/application/platform-ports";
import {
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace as loadOfflineWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser as loadOfflineWorkspaceWithRememberedBrowser,
  loadUnlockedVaultWorkspace as loadUnlockedWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey as loadUnlockedWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser as loadUnlockedWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace as refreshWorkspace,
  LocalStorageSyncError,
  type UnlockedVaultWorkspace,
  type WorkspaceAuthenticatorAccount
} from "../application/vault-workspace";
import type { VaultWorkspacePlatformPorts } from "../application/vault-workspace-ports";

export { clearUnlockedVaultWorkspace, LocalStorageSyncError };
export type { UnlockedVaultWorkspace, WorkspaceAuthenticatorAccount };

function browserPorts(): VaultWorkspacePlatformPorts {
  const snapshotStore = new BrowserOfflineVaultRepository();
  return {
    network: browserNetworkStatus,
    data: {
      snapshotStore,
      fetchAuthorizedOfflineBundle: (cached) => fetchAuthorizedOfflineBundle(cached)
    },
    crypto: {
      unlockPersonalVault,
      unlockPersonalVaultWithUserRootKey,
      recoverUserRootKeyWithRememberedBrowser: (profileId, ...signals) => signals.length ? recoverUserRootKeyWithRememberedBrowser(profileId, signals[0] as AbortSignal | undefined) : recoverUserRootKeyWithRememberedBrowser(profileId),
      recoverUserRootKeyWithPasskey,
      rewrapUserCryptoProfile,
      decryptPayload: async (key, envelope) => {
        const cryptoPort = await import("@/modules/crypto");
        if (!cryptoPort.decryptPayload) throw new Error("Legacy payload decryption is unavailable.");
        return cryptoPort.decryptPayload(key, envelope);
      },
      decryptPayloadWithContext,
      deserializeEncryptedEnvelope,
      unlockSharedVault,
      decryptAccountConfiguration
    }
  };
}

export function loadUnlockedVaultWorkspace(vaultUnlockSecret: string, personalVaultId: string): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspace(vaultUnlockSecret, personalVaultId, browserPorts());
}

export function loadUnlockedVaultWorkspaceWithRememberedBrowser(personalVaultId: string, signal?: AbortSignal): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspaceWithRememberedBrowser(personalVaultId, browserPorts(), signal as CancellationPort | undefined);
}

export function loadUnlockedVaultWorkspaceWithPasskey(personalVaultId: string): Promise<UnlockedVaultWorkspace> {
  return loadUnlockedWorkspaceWithPasskey(personalVaultId, browserPorts());
}

export function loadOfflineVaultWorkspace(profileId: string, vaultUnlockSecret: string): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspace(profileId, vaultUnlockSecret, browserPorts());
}

export function loadOfflineVaultWorkspaceWithRememberedBrowser(profileId: string): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspaceWithRememberedBrowser(profileId, browserPorts());
}

export function refreshUnlockedVaultWorkspace(userRootKey: Uint8Array, expectedProfileId: string): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(userRootKey, expectedProfileId, browserPorts());
}
