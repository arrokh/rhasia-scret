import type { ClientCryptoPort, PortableJsonWebKey, Sha256DigestPort } from "./crypto-ports";
import {
  EncryptedPayloadMigrationError,
  migrateLegacyEncryptedPayloadWithCrypto,
  type EncryptedPayloadMigrationStore,
} from "./encrypted-payload-migration";
import { UserEncryptionPrivateKeyRecoveryError, userEncryptionIdentityContext } from "./user-encryption-identity";
import {
  clearPrivateJwk,
  clearPrivateJwkCandidate,
  isUserEncryptionPrivateKey,
} from "./user-encryption-private-key-payload";

export async function migrateUserEncryptionPrivateKeyWithCrypto(
  userRootKey: Uint8Array,
  legacyEncryptedPrivateKey: Uint8Array,
  publicKey: PortableJsonWebKey,
  crypto: ClientCryptoPort,
  digest: Sha256DigestPort,
  store: EncryptedPayloadMigrationStore,
): Promise<PortableJsonWebKey> {
  try {
    return await migrateLegacyEncryptedPayloadWithCrypto(
      userRootKey,
      legacyEncryptedPrivateKey,
      {
        context: userEncryptionIdentityContext(),
        validatePlaintext: async (plaintext) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
          } catch (error) {
            throw new Error("Legacy User Encryption Private Key payload is invalid.", { cause: error });
          }
          if (!isUserEncryptionPrivateKey(parsed) || !hasMatchingPublicKey(parsed, publicKey)) {
            clearPrivateJwkCandidate(parsed);
            throw new Error("Legacy User Encryption Private Key payload is invalid.");
          }
          try {
            await validateUserEncryptionKeyPair(parsed, publicKey, crypto);
          } catch (error) {
            clearPrivateJwk(parsed);
            throw new Error("Legacy User Encryption Private Key payload is invalid.", { cause: error });
          }
          return parsed;
        },
        clearValidatedPayload: clearPrivateJwk,
      },
      crypto,
      digest,
      store,
    );
  } catch (error) {
    if (!(error instanceof EncryptedPayloadMigrationError)) throw error;
    if (error.stage === "envelope-invalid") throw new UserEncryptionPrivateKeyRecoveryError("envelope-invalid", error);
    if (error.stage === "source-not-legacy") throw new UserEncryptionPrivateKeyRecoveryError("legacy-envelope", error);
    if (error.stage === "decryption-failed")
      throw new UserEncryptionPrivateKeyRecoveryError("decryption-failed", error);
    if (error.stage === "payload-invalid") throw new UserEncryptionPrivateKeyRecoveryError("payload-invalid", error);
    throw error;
  }
}

function hasMatchingPublicKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): boolean {
  return (
    publicKey.kty === "EC" &&
    publicKey.crv === "P-256" &&
    typeof publicKey.x === "string" &&
    typeof publicKey.y === "string" &&
    !("d" in publicKey) &&
    privateKey.kty === publicKey.kty &&
    privateKey.crv === publicKey.crv &&
    privateKey.x === publicKey.x &&
    privateKey.y === publicKey.y
  );
}

async function validateUserEncryptionKeyPair(
  privateKey: PortableJsonWebKey,
  publicKey: PortableJsonWebKey,
  crypto: ClientCryptoPort,
): Promise<void> {
  const probeKey = crypto.generateSymmetricKey();
  const context = { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 } as const;
  let envelope: Awaited<ReturnType<ClientCryptoPort["wrapKeyForRecipientWithContext"]>> | undefined;
  let unwrappedKey: Uint8Array | undefined;
  try {
    envelope = await crypto.wrapKeyForRecipientWithContext(probeKey, publicKey, context);
    unwrappedKey = await crypto.unwrapKeyForRecipientWithContext(envelope, privateKey, context);
    if (!equalBytes(probeKey, unwrappedKey)) throw new Error("User Encryption Key Pair is invalid.");
  } finally {
    probeKey.fill(0);
    unwrappedKey?.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
