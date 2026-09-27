import type { ClientCryptoPort, KeyDerivationPort } from "./crypto-ports";
import type { EncryptedEnvelope } from "./encrypted-envelope-types";
import { validateVaultUnlockSecret } from "./create-personal-vault-initialization";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  VAULT_UNLOCK_KEY_BYTES,
} from "./vault-unlock-key-parameters";

export type EncryptedPersonalVaultProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
};

export type PersonalVaultUnlockResult = {
  userRootKey: Uint8Array;
  personalVaultKey: Uint8Array;
  migratedProfile?: EncryptedPersonalVaultProfile;
};

export type PersonalVaultUnlockFailureStage =
  "invalid-secret" | "key-derivation" | "user-root-key" | "personal-vault-key";

export class PersonalVaultUnlockError extends Error {
  public constructor(
    public readonly stage: PersonalVaultUnlockFailureStage,
    cause?: unknown,
  ) {
    super("Personal Vault cryptographic unlock failed.", { cause });
    this.name = "PersonalVaultUnlockError";
  }
}

export type PersonalVaultUnlockPorts = {
  crypto: ClientCryptoPort;
  keyDerivation: KeyDerivationPort;
};

export async function unlockPersonalVault(
  vaultUnlockSecret: string,
  profile: EncryptedPersonalVaultProfile,
  ports: PersonalVaultUnlockPorts,
): Promise<PersonalVaultUnlockResult> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  try {
    validateVaultUnlockSecret(vaultUnlockSecret);
  } catch (error) {
    throw new PersonalVaultUnlockError("invalid-secret", error);
  }
  if (profile.vaultUnlockSalt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
  let unlockKey: Uint8Array;
  try {
    unlockKey = await ports.keyDerivation.deriveArgon2id(vaultUnlockSecret, profile.vaultUnlockSalt, {
      memoryKiB: ARGON2_MEMORY_KIB,
      iterations: ARGON2_ITERATIONS,
      parallelism: ARGON2_PARALLELISM,
      outputBytes: VAULT_UNLOCK_KEY_BYTES,
    });
  } catch (error) {
    throw new PersonalVaultUnlockError("key-derivation", error);
  }
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    const wrappedUserRootKey = ports.crypto.deserializeEncryptedEnvelope(profile.wrappedUserRootKey);
    try {
      userRootKey = await decryptProfilePayload(
        unlockKey,
        wrappedUserRootKey,
        { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
        ports.crypto,
      );
    } catch (error) {
      throw new PersonalVaultUnlockError("user-root-key", error);
    }
    const encryptedPersonalVaultKey = ports.crypto.deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey);
    try {
      personalVaultKey = await decryptProfilePayload(
        userRootKey,
        encryptedPersonalVaultKey,
        { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 },
        ports.crypto,
      );
      if (personalVaultKey.length !== 32) throw new Error("Personal Vault Encryption Key is invalid.");
    } catch (error) {
      throw new PersonalVaultUnlockError("personal-vault-key", error);
    }
    const migratedProfile =
      wrappedUserRootKey.version === 1 || encryptedPersonalVaultKey.version === 1
        ? await migrateLegacyProfile(
            profile,
            unlockKey,
            userRootKey,
            personalVaultKey,
            wrappedUserRootKey,
            encryptedPersonalVaultKey,
            ports.crypto,
          )
        : undefined;
    return { userRootKey, personalVaultKey, migratedProfile };
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  } finally {
    unlockKey.fill(0);
  }
}

export async function unlockPersonalVaultWithUserRootKey(
  userRootKey: Uint8Array,
  profile: EncryptedPersonalVaultProfile,
  crypto: ClientCryptoPort,
): Promise<Uint8Array> {
  if (profile.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  const personalVaultKey = await decryptProfilePayload(
    userRootKey,
    crypto.deserializeEncryptedEnvelope(profile.encryptedPersonalVaultKey),
    { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 },
    crypto,
  );
  if (personalVaultKey.length !== 32) {
    personalVaultKey.fill(0);
    throw new Error("Personal Vault Encryption Key is invalid.");
  }
  return personalVaultKey;
}

async function decryptProfilePayload(
  key: Uint8Array,
  envelope: EncryptedEnvelope,
  context: Parameters<ClientCryptoPort["decryptPayloadWithContext"]>[2],
  crypto: ClientCryptoPort,
): Promise<Uint8Array> {
  return envelope.version === 1
    ? crypto.decryptPayload(key, envelope)
    : crypto.decryptPayloadWithContext(key, envelope, context);
}

async function migrateLegacyProfile(
  profile: EncryptedPersonalVaultProfile,
  unlockKey: Uint8Array,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  wrappedUserRootKey: EncryptedEnvelope,
  encryptedPersonalVaultKey: EncryptedEnvelope,
  crypto: ClientCryptoPort,
): Promise<EncryptedPersonalVaultProfile> {
  const migratedWrappedUserRootKey =
    wrappedUserRootKey.version === 1
      ? crypto.serializeEncryptedEnvelope(
          await crypto.encryptPayloadWithContext(unlockKey, userRootKey, {
            purpose: "user-root-key-wrap",
            payloadType: "user-root-key",
            keyVersion: 1,
          }),
        )
      : profile.wrappedUserRootKey.slice();
  const migratedPersonalVaultKey =
    encryptedPersonalVaultKey.version === 1
      ? crypto.serializeEncryptedEnvelope(
          await crypto.encryptPayloadWithContext(userRootKey, personalVaultKey, {
            purpose: "vault-key-wrap",
            payloadType: "vault-encryption-key",
            keyVersion: 1,
          }),
        )
      : profile.encryptedPersonalVaultKey.slice();
  return {
    vaultUnlockSalt: profile.vaultUnlockSalt.slice(),
    wrappedUserRootKey: migratedWrappedUserRootKey,
    encryptedPersonalVaultKey: migratedPersonalVaultKey,
    encryptionVersion: profile.encryptionVersion,
  };
}
