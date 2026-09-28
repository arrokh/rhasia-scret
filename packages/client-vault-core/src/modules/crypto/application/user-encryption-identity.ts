import type { ClientCryptoPort, PortableJsonWebKey } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "./encrypted-envelope-types";
import {
  clearPrivateJwk,
  clearPrivateJwkCandidate,
  isUserEncryptionPrivateKey,
} from "./user-encryption-private-key-payload";

export type EncryptedUserEncryptionIdentity = {
  publicKey: PortableJsonWebKey;
  encryptedPrivateKey: EncryptedEnvelope;
};

export type UserEncryptionPrivateKeyRecoveryFailureStage =
  "envelope-invalid" | "legacy-envelope" | "decryption-failed" | "payload-invalid";

export class UserEncryptionPrivateKeyRecoveryError extends Error {
  public constructor(
    public readonly stage: UserEncryptionPrivateKeyRecoveryFailureStage,
    cause?: unknown,
  ) {
    super("User Encryption Private Key recovery failed.", { cause });
    this.name = "UserEncryptionPrivateKeyRecoveryError";
  }
}

export async function createUserEncryptionIdentityWithCrypto(
  userRootKey: Uint8Array,
  crypto: ClientCryptoPort,
): Promise<EncryptedUserEncryptionIdentity> {
  const pair = await crypto.generateUserEncryptionKeyPair();
  const plaintext = new TextEncoder().encode(JSON.stringify(pair.privateKey));
  try {
    return {
      publicKey: { ...pair.publicKey },
      encryptedPrivateKey: await crypto.encryptPayloadWithContext(
        userRootKey,
        plaintext,
        userEncryptionIdentityContext(),
      ),
    };
  } finally {
    plaintext.fill(0);
    clearPrivateJwk(pair.privateKey);
  }
}

export async function recoverUserEncryptionPrivateKeyWithCrypto(
  userRootKey: Uint8Array,
  encryptedPrivateKey: EncryptedEnvelope,
  crypto: ClientCryptoPort,
): Promise<PortableJsonWebKey> {
  if (encryptedPrivateKey.version !== 2) throw new UserEncryptionPrivateKeyRecoveryError("legacy-envelope");

  let plaintext: Uint8Array;
  try {
    plaintext = await crypto.decryptPayloadWithContext(
      userRootKey,
      encryptedPrivateKey,
      userEncryptionIdentityContext(),
    );
  } catch (error) {
    throw new UserEncryptionPrivateKeyRecoveryError("decryption-failed", error);
  }
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch (error) {
      throw new UserEncryptionPrivateKeyRecoveryError("payload-invalid", error);
    }
    if (!isUserEncryptionPrivateKey(parsed)) {
      clearPrivateJwkCandidate(parsed);
      throw new UserEncryptionPrivateKeyRecoveryError("payload-invalid");
    }
    return parsed;
  } finally {
    plaintext.fill(0);
  }
}

export function userEncryptionIdentityContext(): CryptoEnvelopeContext {
  return { purpose: "user-encryption-private-key", payloadType: "user-encryption-private-key", keyVersion: 1 };
}
