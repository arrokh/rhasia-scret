"use client";

import { argon2id } from "hash-wasm";

const ARGON2_MEMORY_KIB = 64 * 1024;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;

export function validateVaultUnlockSecret(secret: string) {
  if (secret.trim().length < 3) {
    throw new Error("A Vault Unlock Secret must contain at least three characters.");
  }
}

export async function deriveVaultUnlockKey(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  validateVaultUnlockSecret(secret);
  if (salt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
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
