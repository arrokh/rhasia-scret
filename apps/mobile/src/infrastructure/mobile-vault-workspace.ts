import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { createAuthenticatorAccountPayloadPort } from "@rhasia-scret/client-vault-core";
import {
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace as loadOfflineWorkspace,
  loadUnlockedVaultWorkspace as loadOnlineWorkspace,
  refreshUnlockedVaultWorkspace as refreshWorkspace,
  type UnlockedVaultWorkspace,
} from "@rhasia-scret/client-vault-core";
import type { VaultWorkspacePlatformPorts } from "@rhasia-scret/client-vault-core";
import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";
import { unlockSharedVaultWithCrypto } from "@rhasia-scret/client-vault-core";
import type { NetworkStatusPort, PortDisposer } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { EncryptedOfflineVaultStore } from "./encrypted-offline-vault-store";
import { nativeOfflineVaultPersistence, nativeOfflineVaultSecureKeys } from "./native-offline-vault-persistence";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { unlockMobilePersonalVault, unlockMobilePersonalVaultWithUserRootKey } from "../application/unlock-mobile-personal-vault";

const accountPayloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);
export const mobileOfflineVaultStore = new EncryptedOfflineVaultStore(
  nativeOfflineVaultPersistence,
  nativeOfflineVaultSecureKeys,
  nativeClientCrypto,
);

class NativeNetworkStatus implements NetworkStatusPort {
  private online = false;
  private readonly listeners = new Set<(online: boolean) => void>();

  public constructor() {
    void NetInfo.fetch().then((state) => this.update(state));
    NetInfo.addEventListener((state) => this.update(state));
  }

  public isOnline(): boolean { return this.online; }

  public subscribe(listener: (online: boolean) => void): PortDisposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(state: NetInfoState): void {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (online === this.online) return;
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }
}

export const nativeNetworkStatus = new NativeNetworkStatus();

export function createMobileVaultWorkspacePorts(transport: AuthenticatedTransport): VaultWorkspacePlatformPorts {
  return {
    network: nativeNetworkStatus,
    data: {
      snapshotStore: mobileOfflineVaultStore,
      fetchAuthorizedOfflineBundle: (cached) => fetchAuthorizedOfflineBundle(transport, cached),
    },
    crypto: {
      unlockPersonalVault: unlockMobilePersonalVault,
      unlockPersonalVaultWithUserRootKey: unlockMobilePersonalVaultWithUserRootKey,
      recoverUserRootKeyWithRememberedBrowser: async () => unsupportedDeviceRecovery(),
      recoverUserRootKeyWithPasskey: async () => unsupportedDeviceRecovery(),
      rewrapUserCryptoProfile: async (profile) => {
        const response = await transport.request({
          url: "/api/user-crypto-profile/rewrap",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profile),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("The migrated crypto profile could not be stored.");
      },
      decryptPayload: nativeClientCrypto.decryptPayload,
      decryptPayloadWithContext: nativeClientCrypto.decryptPayloadWithContext,
      deserializeEncryptedEnvelope: nativeClientCrypto.deserializeEncryptedEnvelope,
      unlockSharedVault: (userRootKey, encryptedVaultKey, encryptedName, vaultId) => unlockSharedVaultWithCrypto(
        nativeClientCrypto,
        userRootKey,
        encryptedVaultKey,
        encryptedName,
        vaultId,
      ),
      decryptAccountConfiguration: accountPayloads.decryptAccountConfiguration,
    },
  };
}

export function loadMobileVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  return loadOnlineWorkspace(vaultUnlockSecret, personalVaultId, createMobileVaultWorkspacePorts(transport));
}

export function refreshMobileVaultWorkspace(
  workspace: UnlockedVaultWorkspace,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(workspace.userRootKey, workspace.profileId, createMobileVaultWorkspacePorts(transport));
}

export function loadOfflineMobileVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspace(profileId, vaultUnlockSecret, createMobileVaultWorkspacePorts(transport));
}

export { clearUnlockedVaultWorkspace };
export type { UnlockedVaultWorkspace };

async function fetchAuthorizedOfflineBundle(
  transport: AuthenticatedTransport,
  cached: EncryptedOfflineVaultBundle | null,
): Promise<EncryptedOfflineVaultBundle> {
  const response = await transport.request({
    url: "/api/sync/offline-bundle",
    method: "GET",
    headers: cached ? { "if-none-match": `"${cached.synchronizationToken}"` } : undefined,
    cache: "no-store",
  });
  if (response.status === 304) {
    if (!cached) throw new Error("The server returned an unchanged synchronization bundle without a local snapshot.");
    const synchronizedAt = response.headers.get("x-synchronized-at") ?? cached.synchronizedAt;
    return parseEncryptedOfflineVaultBundle({ ...cached, synchronizedAt });
  }
  if (!response.ok) throw new Error("The authorized encrypted Vault snapshot could not be loaded.");
  return parseEncryptedOfflineVaultBundle(await response.json<unknown>());
}

function unsupportedDeviceRecovery(): never {
  throw new Error("Device-bound native recovery has not been hardware validated.");
}
