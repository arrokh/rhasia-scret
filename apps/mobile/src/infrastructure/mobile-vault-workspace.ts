import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import {
  createAuthenticatorAccountPayloadPort,
  createUserEncryptionIdentityWithCrypto,
  commitUserCryptoProfileMigration,
  commitEncryptedPayloadMigrationTransport,
  migrateLegacySharedVaultKeyWrapWithCrypto,
  unwrapSharedVaultKeyWithCrypto,
} from "@rhasia-scret/client-vault-core";
import { commitUserEncryptionPrivateKeyMigration } from "@rhasia-scret/client-vault-core/modules/crypto/application/user-encryption-identity-migration-transport";
import { migrateUserEncryptionPrivateKeyWithCrypto } from "@rhasia-scret/client-vault-core/modules/crypto/application/user-encryption-private-key-migration";
import {
  clearUnlockedVaultWorkspace,
  evictSharedVaultWorkspace,
  loadOfflineVaultWorkspace as loadOfflineWorkspace,
  loadUnlockedVaultWorkspace as loadOnlineWorkspace,
  refreshUnlockedVaultWorkspace as refreshWorkspace,
  type UnlockedVaultWorkspace,
} from "@rhasia-scret/client-vault-core";
import type { VaultWorkspacePlatformPorts } from "@rhasia-scret/client-vault-core";
import { AuthorizedWorkspaceTransport, type AuthorizedWorkspaceResponse } from "@rhasia-scret/client-vault-core";
import { recoverUserEncryptionPrivateKeyWithCrypto } from "@rhasia-scret/client-vault-core";
import type { CancellationPort, NetworkStatusPort, PortDisposer } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";
import { EncryptedOfflineVaultStore } from "./encrypted-offline-vault-store";
import { nativeOfflineVaultPersistence, nativeOfflineVaultSecureKeys } from "./native-offline-vault-persistence";
import { bytesToBase64, type AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
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
      fetchAuthorizedWorkspaceBundle: (signal) => fetchAuthorizedWorkspaceBundle(transport, signal),
      migrateUserCryptoProfile: (migration, signal) => commitUserCryptoProfileMigration(transport, migration, signal),
      migratePersonalVaultName: (vaultId, expectedKeyVersion, migration, signal) =>
        commitEncryptedPayloadMigrationTransport(
          transport,
          "/v1/personal-vault/name/migration",
          { vaultId, expectedKeyVersion },
          migration,
          signal,
        ),
      migrateSharedVaultName: (vaultId, expectedKeyVersion, migration, signal) =>
        commitEncryptedPayloadMigrationTransport(
          transport,
          `/v1/shared-vaults/${encodeURIComponent(vaultId)}/name/migration`,
          { expectedKeyVersion },
          migration,
          signal,
        ),
      migrateSharedVaultKeyWrap: (vaultId, expectedKeyVersion, migration, signal) =>
        commitEncryptedPayloadMigrationTransport(
          transport,
          `/v1/shared-vaults/${encodeURIComponent(vaultId)}/key-wrap/migration`,
          { expectedKeyVersion },
          migration,
          signal,
        ),
      migratePersonalAuthenticatorAccount: (
        vaultId,
        accountId,
        expectedRevision,
        expectedKeyVersion,
        migration,
        signal,
      ) =>
        commitEncryptedPayloadMigrationTransport(
          transport,
          `/v1/vaults/${encodeURIComponent(vaultId)}/accounts/migration`,
          { accountId, expectedRevision, expectedKeyVersion },
          migration,
          signal,
        ),
      migrateSharedAuthenticatorAccount: (
        vaultId,
        accountId,
        expectedRevision,
        expectedKeyVersion,
        migration,
        signal,
      ) =>
        commitEncryptedPayloadMigrationTransport(
          transport,
          `/v1/shared-vaults/${encodeURIComponent(vaultId)}/accounts/migration`,
          { accountId, expectedRevision, expectedKeyVersion },
          migration,
          signal,
        ),
      registerUserEncryptionIdentity: async (identity, signal) => {
        const response = await transport.request({
          url: "/v1/user-encryption-identity",
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            publicKey: identity.publicKey,
            encryptedPrivateKey: bytesToBase64(identity.encryptedPrivateKey),
            encryptionVersion: identity.encryptionVersion,
          }),
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
        if (response.status === 204) return true;
        if (response.status === 409) return false;
        throw new Error("User Encryption Identity registration failed.");
      },
    },
    migrationDigest: nativeCryptoPrimitives,
    crypto: {
      unlockPersonalVault: unlockMobilePersonalVault,
      unlockPersonalVaultWithUserRootKey: unlockMobilePersonalVaultWithUserRootKey,
      recoverUserRootKeyWithRememberedBrowser: async () => unsupportedDeviceRecovery(),
      recoverUserRootKeyWithPasskey: async () => unsupportedDeviceRecovery(),
      decryptPayload: nativeClientCrypto.decryptPayload,
      decryptPayloadWithContext: nativeClientCrypto.decryptPayloadWithContext,
      encryptPayloadWithContext: nativeClientCrypto.encryptPayloadWithContext,
      serializeEncryptedEnvelope: nativeClientCrypto.serializeEncryptedEnvelope,
      deserializeEncryptedEnvelope: nativeClientCrypto.deserializeEncryptedEnvelope,
      recoverOrMigratePrivateKey: (userRootKey, encryptedPrivateKey, publicKey, userEncryptionKeyVersion, signal) => {
        if (encryptedPrivateKey[0] === 1) {
          return migrateUserEncryptionPrivateKeyWithCrypto(
            userRootKey,
            encryptedPrivateKey,
            publicKey,
            nativeClientCrypto,
            nativeCryptoPrimitives,
            {
              commitEncryptedPayloadMigration: (request) =>
                commitUserEncryptionPrivateKeyMigration(transport, userEncryptionKeyVersion, request, signal),
            },
          );
        }
        return recoverUserEncryptionPrivateKeyWithCrypto(
          userRootKey,
          nativeClientCrypto.deserializeEncryptedEnvelope(encryptedPrivateKey),
          nativeClientCrypto,
        );
      },
      createUserEncryptionIdentity: (userRootKey) =>
        createUserEncryptionIdentityWithCrypto(userRootKey, nativeClientCrypto),
      unwrapSharedVaultKey: (userRootKey, encryptedVaultKey, context) =>
        unwrapSharedVaultKeyWithCrypto(nativeClientCrypto, userRootKey, encryptedVaultKey, context),
      migrateSharedVaultKeyWrap: (userRootKey, encryptedVaultKey, privateKey, publicKey, context, store) =>
        migrateLegacySharedVaultKeyWrapWithCrypto(
          userRootKey,
          encryptedVaultKey,
          privateKey,
          publicKey,
          context,
          nativeClientCrypto,
          nativeCryptoPrimitives,
          store,
        ),
      decryptAccountConfiguration: accountPayloads.decryptAccountConfiguration,
      parseDecryptedAccountPayload: accountPayloads.parseDecryptedAccountPayload,
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
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(
    workspace.userRootKey,
    workspace.profileId,
    createMobileVaultWorkspacePorts(transport),
    signal,
  );
}

export function refreshMobileVaultWorkspaceWithKey(
  userRootKey: Uint8Array,
  profileId: string,
  transport: AuthenticatedTransport,
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  return refreshWorkspace(userRootKey, profileId, createMobileVaultWorkspacePorts(transport), signal);
}

export function loadOfflineMobileVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  return loadOfflineWorkspace(profileId, vaultUnlockSecret, createMobileVaultWorkspacePorts(transport));
}

export { clearUnlockedVaultWorkspace, evictSharedVaultWorkspace };
export type { UnlockedVaultWorkspace };

async function fetchAuthorizedWorkspaceBundle(
  transport: AuthenticatedTransport,
  signal?: CancellationPort,
): Promise<AuthorizedWorkspaceResponse> {
  return new AuthorizedWorkspaceTransport(transport).fetch(signal);
}

function unsupportedDeviceRecovery(): never {
  throw new Error("Device-bound native recovery has not been hardware validated.");
}
