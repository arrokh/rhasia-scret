"use client";

import { argon2id } from "hash-wasm";

const ENCRYPTION_VERSION = 1;
const ARGON2_MEMORY_KIB = 64 * 1024;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;

type EncryptedBlob = Uint8Array;

export type PersonalVaultInitializationMaterial = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: EncryptedBlob;
  encryptedPersonalVaultKey: EncryptedBlob;
  encryptedVaultName: EncryptedBlob;
  encryptionVersion: number;
};

export async function initializePersonalVaultInBrowser(
  vaultUnlockSecret: string,
  vaultName: string
): Promise<PersonalVaultInitializationMaterial> {
  validateVaultUnlockSecret(vaultUnlockSecret);
  if (!vaultName.trim()) throw new Error("A Vault Name is required.");

  const vaultUnlockSalt = randomBytes(16);
  const vaultUnlockKey = await deriveVaultUnlockKey(vaultUnlockSecret, vaultUnlockSalt);
  const userRootKey = randomBytes(32);
  const personalVaultKey = randomBytes(32);
  return {
    vaultUnlockSalt,
    wrappedUserRootKey: await encrypt(vaultUnlockKey, userRootKey),
    encryptedPersonalVaultKey: await encrypt(userRootKey, personalVaultKey),
    encryptedVaultName: await encrypt(personalVaultKey, new TextEncoder().encode(vaultName)),
    encryptionVersion: ENCRYPTION_VERSION
  };
}

function validateVaultUnlockSecret(secret: string) {
  if (secret.trim().split(/\s+/).filter(Boolean).length < 4) {
    throw new Error("A Vault Unlock Secret must contain at least four words.");
  }
}

async function deriveVaultUnlockKey(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await argon2id({
    password: secret.normalize("NFKC"),
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: 32,
    outputType: "binary"
  });
  if (typeof key === "string") throw new Error("Argon2id did not return binary key material.");
  return key;
}

async function encrypt(keyBytes: Uint8Array, plaintext: Uint8Array): Promise<EncryptedBlob> {
  const nonce = randomBytes(12);
  const key = await crypto.subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: copyBytes(nonce) }, key, copyBytes(plaintext)));
  const blob = new Uint8Array(1 + nonce.length + ciphertext.length);
  blob[0] = ENCRYPTION_VERSION;
  blob.set(nonce, 1);
  blob.set(ciphertext, 1 + nonce.length);
  return blob;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
