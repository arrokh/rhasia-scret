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
import { AuthorizedOfflineBundleTransport, type EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";
import { unlockSharedVaultWithCrypto } from "@rhasia-scret/client-vault-core";
import type { NetworkStatusPort, PortDisposer } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { EncryptedOfflineVaultStore } from "./encrypted-offline-vault-store";
import { nativeOfflineVaultPersistence, nativeOfflineVaultSecureKeys } from "./native-offline-vault-persistence";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import {
  unlockMobilePersonalVault,
  unlockMobilePersonalVaultWithUserRootKey,
} from "../application/unlock-mobile-personal-vault";

const accountPayloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);
export const mobileOfflineVaultStore = new EncryptedOfflineVaultStore(
  nativeOfflineVaultPersistence,
  nativeOfflineVaultSecureKeys,
  nativeClientCrypto,
);

type NativeNetworkSubscription = { remove(): void } | (() => void);
type NativeNetworkInfo = {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (state: NetInfoState) => void): NativeNetworkSubscription;
};

export class NativeNetworkStatus implements NetworkStatusPort {
  private online = false;
  private listening = false;
  private subscription: NativeNetworkSubscription | null = null;
  private readonly listeners = new Set<(online: boolean) => void>();

  public constructor(private readonly netInfo: NativeNetworkInfo = NetInfo) {
    void this.netInfo.fetch().then(
      (state) => this.update(state),
      () => undefined,
    );
  }

  public isOnline(): boolean {
    return this.online;
  }

  public subscribe(listener: (online: boolean) => void): PortDisposer {
    this.listeners.add(listener);
    if (!this.listening) {
      this.listening = true;
      this.subscription = this.netInfo.addEventListener((state) => this.update(state));
      void this.netInfo.fetch().then(
        (state) => this.update(state),
        () => undefined,
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopListening();
    };
  }

  private stopListening(): void {
    if (typeof this.subscription === "function") this.subscription();
    else this.subscription?.remove();
    this.subscription = null;
    this.listening = false;
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
      unlockSharedVault: (userRootKey, encryptedVaultKey, encryptedName, vaultId) =>
        unlockSharedVaultWithCrypto(nativeClientCrypto, userRootKey, encryptedVaultKey, encryptedName, vaultId),
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

export function refreshMobileVaultWorkspaceWithKey(
  userRootKey: Uint8Array,
  profileId: string,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(userRootKey, profileId, createMobileVaultWorkspacePorts(transport));
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
  return new AuthorizedOfflineBundleTransport(transport).fetch(cached);
}

function unsupportedDeviceRecovery(): never {
  throw new Error("Device-bound native recovery has not been hardware validated.");
}
