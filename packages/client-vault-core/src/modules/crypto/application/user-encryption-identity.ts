import type { ClientCryptoPort, PortableJsonWebKey } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "./encrypted-envelope-types";

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
    clearPrivateKeyMaterial(pair.privateKey);
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
    if (!isPrivateKey(parsed)) throw new UserEncryptionPrivateKeyRecoveryError("payload-invalid");
    return parsed;
  } finally {
    plaintext.fill(0);
  }
}

export function userEncryptionIdentityContext(): CryptoEnvelopeContext {
  return { purpose: "user-encryption-private-key", payloadType: "user-encryption-private-key", keyVersion: 1 };
}

function clearPrivateKeyMaterial(privateKey: PortableJsonWebKey): void {
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}

function isPrivateKey(value: unknown): value is PortableJsonWebKey {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kty === "EC" &&
    (value as Record<string, unknown>).crv === "P-256" &&
    typeof (value as Record<string, unknown>).x === "string" &&
    typeof (value as Record<string, unknown>).y === "string" &&
    typeof (value as Record<string, unknown>).d === "string"
  );
}
