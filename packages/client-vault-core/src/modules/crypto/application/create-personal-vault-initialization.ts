import type { ClientCryptoPort, KeyDerivationPort, PortableJsonWebKey } from "./crypto-ports";
import { createUserEncryptionIdentityWithCrypto } from "./user-encryption-identity";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  VAULT_UNLOCK_KEY_BYTES,
} from "./vault-unlock-key-parameters";

const encryptionVersion = 1;
const vaultUnlockSaltBytes = 16;

export type PersonalVaultInitializationMaterial = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptedVaultName: Uint8Array;
  userEncryptionPublicKey: PortableJsonWebKey;
  encryptedUserPrivateKey: Uint8Array;
  userEncryptionKeyVersion: 1;
  encryptionVersion: number;
};

export type PersonalVaultInitializationPorts = {
  crypto: ClientCryptoPort;
  keyDerivation: KeyDerivationPort;
};

export async function createPersonalVaultInitialization(
  vaultUnlockSecret: string,
  vaultName: string,
  ports: PersonalVaultInitializationPorts,
): Promise<PersonalVaultInitializationMaterial> {
  validateVaultUnlockSecret(vaultUnlockSecret);
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");

  const vaultUnlockSalt = ports.crypto.randomBytes(vaultUnlockSaltBytes);
  if (vaultUnlockSalt.length !== vaultUnlockSaltBytes)
    throw new Error("Crypto provider returned an invalid Vault Unlock salt.");
  const vaultUnlockKey = await ports.keyDerivation.deriveArgon2id(vaultUnlockSecret, vaultUnlockSalt, {
    memoryKiB: ARGON2_MEMORY_KIB,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    outputBytes: VAULT_UNLOCK_KEY_BYTES,
  });
  const userRootKey = ports.crypto.generateSymmetricKey();
  const personalVaultKey = ports.crypto.generateSymmetricKey();
  const nameBytes = new TextEncoder().encode(vaultName);
  let encryptedUserPrivateKey: Uint8Array | undefined;
  let identity: Awaited<ReturnType<typeof createUserEncryptionIdentityWithCrypto>> | undefined;
  try {
    identity = await createUserEncryptionIdentityWithCrypto(userRootKey, ports.crypto);
    encryptedUserPrivateKey = ports.crypto.serializeEncryptedEnvelope(identity.encryptedPrivateKey);
    return {
      vaultUnlockSalt,
      wrappedUserRootKey: ports.crypto.serializeEncryptedEnvelope(
        await ports.crypto.encryptPayloadWithContext(vaultUnlockKey, userRootKey, {
          purpose: "user-root-key-wrap",
          payloadType: "user-root-key",
          keyVersion: 1,
        }),
      ),
      encryptedPersonalVaultKey: ports.crypto.serializeEncryptedEnvelope(
        await ports.crypto.encryptPayloadWithContext(userRootKey, personalVaultKey, {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          keyVersion: 1,
        }),
      ),
      encryptedVaultName: ports.crypto.serializeEncryptedEnvelope(
        await ports.crypto.encryptPayloadWithContext(personalVaultKey, nameBytes, {
          purpose: "vault-name",
          payloadType: "vault-name",
          keyVersion: 1,
        }),
      ),
      userEncryptionPublicKey: identity.publicKey,
      encryptedUserPrivateKey,
      userEncryptionKeyVersion: 1,
      encryptionVersion,
    };
  } finally {
    identity?.encryptedPrivateKey.nonce.fill(0);
    identity?.encryptedPrivateKey.ciphertext.fill(0);
    nameBytes.fill(0);
    vaultUnlockKey.fill(0);
    userRootKey.fill(0);
    personalVaultKey.fill(0);
  }
}

export function clearPersonalVaultInitializationMaterial(material: PersonalVaultInitializationMaterial): void {
  material.vaultUnlockSalt.fill(0);
  material.wrappedUserRootKey.fill(0);
  material.encryptedPersonalVaultKey.fill(0);
  material.encryptedVaultName.fill(0);
  material.encryptedUserPrivateKey.fill(0);
}

export function validateVaultUnlockSecret(secret: string): void {
  if (secret.trim().length < 3) throw new Error("A Vault Unlock Secret must contain at least three characters.");
}
