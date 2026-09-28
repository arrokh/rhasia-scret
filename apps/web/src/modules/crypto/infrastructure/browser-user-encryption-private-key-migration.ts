"use client";

import {
  recoverUserEncryptionPrivateKeyWithCrypto,
  UserEncryptionPrivateKeyRecoveryError,
  type EncryptedEnvelope,
  type PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import type { CancellationPort } from "@rhasia-scret/client-vault-core";
import type {
  EncryptedPayloadMigrationCommit,
  EncryptedPayloadMigrationCommitResult,
} from "@rhasia-scret/client-vault-core/modules/crypto/application/encrypted-payload-migration";
import { commitUserEncryptionPrivateKeyMigration as commitMigration } from "@rhasia-scret/client-vault-core/modules/crypto/application/user-encryption-identity-migration-transport";
import { migrateUserEncryptionPrivateKeyWithCrypto } from "@rhasia-scret/client-vault-core/modules/crypto/application/user-encryption-private-key-migration";
import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import { browserClientCryptoPort } from "./browser-client-crypto-port";
import { browserSha256Digest } from "./browser-sha256-digest";

export function commitUserEncryptionPrivateKeyMigration(
  userEncryptionKeyVersion: number,
  request: EncryptedPayloadMigrationCommit,
  signal?: CancellationPort,
): Promise<EncryptedPayloadMigrationCommitResult> {
  return commitMigration(browserAuthenticatedTransport, userEncryptionKeyVersion, request, signal);
}

export function recover(
  userRootKey: Uint8Array,
  encryptedPrivateKey: Uint8Array,
  publicKey: PortableJsonWebKey,
  userEncryptionKeyVersion: number,
  signal?: CancellationPort,
): Promise<PortableJsonWebKey> {
  if (encryptedPrivateKey[0] === 1) {
    return migrateUserEncryptionPrivateKeyWithCrypto(
      userRootKey,
      encryptedPrivateKey,
      publicKey,
      browserClientCryptoPort,
      browserSha256Digest,
      {
        commitEncryptedPayloadMigration: (request) =>
          commitUserEncryptionPrivateKeyMigration(userEncryptionKeyVersion, request, signal),
      },
    );
  }

  let envelope: EncryptedEnvelope;
  try {
    envelope = browserClientCryptoPort.deserializeEncryptedEnvelope(encryptedPrivateKey);
  } catch (error) {
    throw new UserEncryptionPrivateKeyRecoveryError("envelope-invalid", error);
  }
  return recoverUserEncryptionPrivateKeyWithCrypto(userRootKey, envelope, browserClientCryptoPort);
}
