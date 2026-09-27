import type { CancellationPort, NetworkStatusPort } from "../../../shared/application/platform-ports";
import type { OfflineVaultSnapshotStore } from "../../sync/application/client-storage-ports";
import type { AuthorizedWorkspaceResponse } from "../../sync/domain/offline-vault-bundle";
import type { PortableJsonWebKey } from "../../crypto/application/crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "../../crypto/application/encrypted-envelope-types";
import type { EncryptedUserEncryptionIdentity } from "../../crypto/application/user-encryption-identity";
import type { SharedVaultUnlockContext } from "../../vault-membership/application/unlock-shared-vault";
import type { DecryptedAuthenticatorAccount } from "./account-payload-ports";

export type WorkspacePersonalVaultProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
};

export type WorkspacePersonalVaultUnlock = {
  userRootKey: Uint8Array;
  personalVaultKey: Uint8Array;
  migratedProfile?: WorkspacePersonalVaultProfile;
};

export type WorkspaceSharedVaultUnlock = {
  name: string;
  vaultKey: Uint8Array;
};

export interface VaultWorkspaceCryptoPort {
  unlockPersonalVault(secret: string, profile: WorkspacePersonalVaultProfile): Promise<WorkspacePersonalVaultUnlock>;
  unlockPersonalVaultWithUserRootKey(
    userRootKey: Uint8Array,
    profile: WorkspacePersonalVaultProfile,
  ): Promise<Uint8Array>;
  recoverUserRootKeyWithRememberedBrowser(profileId: string, signal?: CancellationPort): Promise<Uint8Array>;
  recoverUserRootKeyWithPasskey(): Promise<Uint8Array>;
  rewrapUserCryptoProfile(profile: {
    vaultUnlockSalt: string;
    wrappedUserRootKey: string;
    encryptedPersonalVaultKey: string;
    encryptionVersion: number;
  }): Promise<void>;
  decryptPayload(key: Uint8Array, envelope: EncryptedEnvelope): Promise<Uint8Array>;
  decryptPayloadWithContext(
    key: Uint8Array,
    envelope: EncryptedEnvelope,
    context: CryptoEnvelopeContext,
  ): Promise<Uint8Array>;
  serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array;
  deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope;
  recoverUserEncryptionPrivateKey(
    userRootKey: Uint8Array,
    encryptedPrivateKey: Uint8Array,
  ): Promise<PortableJsonWebKey>;
  createUserEncryptionIdentity(userRootKey: Uint8Array): Promise<EncryptedUserEncryptionIdentity>;
  unlockSharedVault(
    userRootKey: Uint8Array,
    encryptedVaultKey: Uint8Array,
    encryptedName: Uint8Array,
    context: SharedVaultUnlockContext,
  ): Promise<WorkspaceSharedVaultUnlock>;
  decryptAccountConfiguration(
    vaultKey: Uint8Array,
    encryptedPayload: Uint8Array,
    context: CryptoEnvelopeContext,
  ): Promise<DecryptedAuthenticatorAccount>;
}

export interface VaultWorkspaceDataPort {
  readonly snapshotStore: OfflineVaultSnapshotStore;
  fetchAuthorizedWorkspaceBundle(signal?: CancellationPort): Promise<AuthorizedWorkspaceResponse>;
  registerUserEncryptionIdentity(
    identity: {
      publicKey: PortableJsonWebKey;
      encryptedPrivateKey: Uint8Array;
      encryptionVersion: 1;
    },
    signal?: CancellationPort,
  ): Promise<boolean>;
}

export type VaultWorkspacePlatformPorts = {
  crypto: VaultWorkspaceCryptoPort;
  data: VaultWorkspaceDataPort;
  network: NetworkStatusPort;
};
