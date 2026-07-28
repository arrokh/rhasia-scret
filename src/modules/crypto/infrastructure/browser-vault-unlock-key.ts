"use client";

import { argon2id } from "hash-wasm";
import { measureBrowserOperation } from "@/shared/infrastructure/browser-performance";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  VAULT_UNLOCK_KEY_BYTES
} from "./vault-unlock-key-parameters";

type DerivationResponse = { ok: true; key: ArrayBuffer } | { ok: false };

export function validateVaultUnlockSecret(secret: string) {
  if (secret.trim().length < 3) {
    throw new Error("A Vault Unlock Secret must contain at least three characters.");
  }
}

export async function deriveVaultUnlockKey(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  validateVaultUnlockSecret(secret);
  if (salt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
  return measureBrowserOperation("rhsia:unlock:kdf", () => deriveVaultUnlockKeyMeasured(secret, salt));
}

async function deriveVaultUnlockKeyMeasured(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  if (typeof Worker === "undefined") return deriveVaultUnlockKeyInline(secret, salt);

  const password = new TextEncoder().encode(secret.normalize("NFKC"));
  const copiedSalt = copyBytes(salt);
  const worker = new Worker(new URL("./browser-vault-unlock-key-worker.ts", import.meta.url), { type: "module" });
  try {
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<DerivationResponse>) => {
          if (!event.data.ok || event.data.key.byteLength !== VAULT_UNLOCK_KEY_BYTES) {
            reject(new Error("Vault Unlock Key derivation failed."));
            return;
          }
          resolve(new Uint8Array(event.data.key));
        };
        worker.onerror = () => reject(new Error("Vault Unlock Key Worker failed."));
        worker.postMessage(
          { password: password.buffer, salt: copiedSalt.buffer },
          [password.buffer, copiedSalt.buffer]
        );
      });
    } catch {
      // Module Workers may be unavailable offline or under a restrictive policy.
      return await deriveVaultUnlockKeyInline(secret, salt);
    }
  } finally {
    worker.terminate();
    if (password.byteLength > 0) password.fill(0);
    if (copiedSalt.byteLength > 0) copiedSalt.fill(0);
  }
}

async function deriveVaultUnlockKeyInline(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await argon2id({
    password: secret.normalize("NFKC"),
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: VAULT_UNLOCK_KEY_BYTES,
    outputType: "binary"
  });
  if (typeof key === "string") throw new Error("Argon2id did not return binary key material.");
  return key;
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy;
}
