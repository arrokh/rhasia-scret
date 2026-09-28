import type { CancellationPort, NetworkStatusPort } from "../../../shared/application/platform-ports";
import type { OfflineVaultSnapshotStore } from "../../sync/application/client-storage-ports";
import type { AuthorizedWorkspaceResponse } from "../../sync/domain/offline-vault-bundle";
import type { PortableJsonWebKey, Sha256DigestPort } from "../../crypto/application/crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "../../crypto/application/encrypted-envelope-types";
import type { EncryptedUserEncryptionIdentity } from "../../crypto/application/user-encryption-identity";
import type { PersonalVaultKeyUnlockResult } from "../../crypto/application/unlock-personal-vault";
import type {
  EncryptedPayloadMigrationCommit,
  EncryptedPayloadMigrationCommitResult,
  EncryptedPayloadMigrationStore,
} from "../../crypto/application/encrypted-payload-migration";
import type {
  UserCryptoProfileMigrationRequest,
  UserCryptoProfileMigrationResult,
} from "../../crypto/application/user-crypto-profile-migration-transport";
import type { SharedVaultUnlockContext } from "../../vault-membership/application/unlock-shared-vault";
import type {
  SharedVaultKeyWrapMigrationContext,
  SharedVaultKeyWrapMigrationResult,
} from "../../vault-membership/application/shared-vault-key-wrap-migration";
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

export interface VaultWorkspaceCryptoPort {
  unlockPersonalVault(secret: string, profile: WorkspacePersonalVaultProfile): Promise<WorkspacePersonalVaultUnlock>;
  unlockPersonalVaultWithUserRootKey(
    userRootKey: Uint8Array,
    profile: WorkspacePersonalVaultProfile,
  ): Promise<PersonalVaultKeyUnlockResult>;
  recoverUserRootKeyWithRememberedBrowser(profileId: string, signal?: CancellationPort): Promise<Uint8Array>;
  recoverUserRootKeyWithPasskey(): Promise<Uint8Array>;
  decryptPayload(key: Uint8Array, envelope: EncryptedEnvelope): Promise<Uint8Array>;
  decryptPayloadWithContext(
    key: Uint8Array,
    envelope: EncryptedEnvelope,
    context: CryptoEnvelopeContext,
  ): Promise<Uint8Array>;
  encryptPayloadWithContext(
    key: Uint8Array,
    plaintext: Uint8Array,
    context: CryptoEnvelopeContext,
  ): Promise<EncryptedEnvelope>;
  serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array;
  deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope;
  /** Recovers or explicitly migrates the User Encryption Identity private key. */
  recoverOrMigratePrivateKey(
    userRootKey: Uint8Array,
    encryptedPrivateKey: Uint8Array,
    publicKey: PortableJsonWebKey,
    userEncryptionKeyVersion: number,
    signal?: CancellationPort,
  ): Promise<PortableJsonWebKey>;
  createUserEncryptionIdentity(userRootKey: Uint8Array): Promise<EncryptedUserEncryptionIdentity>;
  unwrapSharedVaultKey(
    userRootKey: Uint8Array,
    encryptedVaultKey: Uint8Array,
    context: SharedVaultUnlockContext,
  ): Promise<Uint8Array>;
  migrateSharedVaultKeyWrap(
    userRootKey: Uint8Array,
    encryptedVaultKey: Uint8Array,
    privateKey: PortableJsonWebKey,
    publicKey: PortableJsonWebKey,
    context: SharedVaultKeyWrapMigrationContext,
    store: EncryptedPayloadMigrationStore,
  ): Promise<SharedVaultKeyWrapMigrationResult>;
  decryptAccountConfiguration(
    vaultKey: Uint8Array,
    encryptedPayload: Uint8Array,
    context: CryptoEnvelopeContext,
  ): Promise<DecryptedAuthenticatorAccount>;
  parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount;
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
  migrateUserCryptoProfile(
    migration: UserCryptoProfileMigrationRequest,
    signal?: CancellationPort,
  ): Promise<UserCryptoProfileMigrationResult>;
  migratePersonalVaultName(
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigrationCommit,
    signal?: CancellationPort,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
  migrateSharedVaultName(
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigrationCommit,
    signal?: CancellationPort,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
  migrateSharedVaultKeyWrap(
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigrationCommit,
    signal?: CancellationPort,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
  migratePersonalAuthenticatorAccount(
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigrationCommit,
    signal?: CancellationPort,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
  migrateSharedAuthenticatorAccount(
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigrationCommit,
    signal?: CancellationPort,
  ): Promise<EncryptedPayloadMigrationCommitResult>;
}

export type VaultWorkspacePlatformPorts = {
  crypto: VaultWorkspaceCryptoPort;
  data: VaultWorkspaceDataPort;
  network: NetworkStatusPort;
  migrationDigest: Sha256DigestPort;
};
