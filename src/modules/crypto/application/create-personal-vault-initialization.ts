import type { ClientCryptoPort, KeyDerivationPort } from "./crypto-ports";
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
  if (vaultUnlockSalt.length !== vaultUnlockSaltBytes) throw new Error("Crypto provider returned an invalid Vault Unlock salt.");
  const vaultUnlockKey = await ports.keyDerivation.deriveArgon2id(vaultUnlockSecret, vaultUnlockSalt, {
    memoryKiB: ARGON2_MEMORY_KIB,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    outputBytes: VAULT_UNLOCK_KEY_BYTES,
  });
  const userRootKey = ports.crypto.generateSymmetricKey();
  const personalVaultKey = ports.crypto.generateSymmetricKey();
  const nameBytes = new TextEncoder().encode(vaultName);
  try {
    return {
      vaultUnlockSalt,
      wrappedUserRootKey: ports.crypto.serializeEncryptedEnvelope(await ports.crypto.encryptPayloadWithContext(
        vaultUnlockKey,
        userRootKey,
        { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
      )),
      encryptedPersonalVaultKey: ports.crypto.serializeEncryptedEnvelope(await ports.crypto.encryptPayloadWithContext(
        userRootKey,
        personalVaultKey,
        { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 },
      )),
      encryptedVaultName: ports.crypto.serializeEncryptedEnvelope(await ports.crypto.encryptPayloadWithContext(
        personalVaultKey,
        nameBytes,
        { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
      )),
      encryptionVersion,
    };
  } finally {
    nameBytes.fill(0);
    vaultUnlockKey.fill(0);
    userRootKey.fill(0);
    personalVaultKey.fill(0);
  }
}

export function validateVaultUnlockSecret(secret: string): void {
  if (secret.trim().length < 3) throw new Error("A Vault Unlock Secret must contain at least three characters.");
}
