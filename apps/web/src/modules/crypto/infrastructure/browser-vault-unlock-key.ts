"use client";

import { argon2id } from "hash-wasm";
import type { CancellationPort } from "@rhasia-scret/client-vault-core";
import type { Argon2idParameters, KeyDerivationPort } from "@rhasia-scret/client-vault-core";
import { validateVaultUnlockSecret } from "@rhasia-scret/client-vault-core";
import { measureBrowserOperation } from "@/shared/infrastructure/browser-performance";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  VAULT_UNLOCK_KEY_BYTES
} from "./vault-unlock-key-parameters";

type DerivationResponse = { ok: true; key: ArrayBuffer } | { ok: false };

export { validateVaultUnlockSecret } from "@rhasia-scret/client-vault-core";

export class BrowserArgon2idPort implements KeyDerivationPort {
  deriveArgon2id(secret: string, salt: Uint8Array, parameters: Argon2idParameters, signal?: CancellationPort): Promise<Uint8Array> {
    throwIfCancelled(signal);
    return measureBrowserOperation("rhsia:unlock:kdf", () => deriveVaultUnlockKeyMeasured(secret, salt, parameters, signal));
  }
}

export const browserArgon2idPort = new BrowserArgon2idPort();

export async function deriveVaultUnlockKey(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  validateVaultUnlockSecret(secret);
  if (salt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
  return browserArgon2idPort.deriveArgon2id(secret, salt, {
    memoryKiB: ARGON2_MEMORY_KIB,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    outputBytes: VAULT_UNLOCK_KEY_BYTES
  });
}

async function deriveVaultUnlockKeyMeasured(secret: string, salt: Uint8Array, parameters: Argon2idParameters, signal?: CancellationPort): Promise<Uint8Array> {
  validateVaultUnlockSecret(secret);
  if (salt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
  throwIfCancelled(signal);
  if (typeof Worker === "undefined" || !usesDefaultParameters(parameters)) return deriveVaultUnlockKeyInline(secret, salt, parameters);

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
      return await deriveVaultUnlockKeyInline(secret, salt, parameters);
    }
  } finally {
    worker.terminate();
    if (password.byteLength > 0) password.fill(0);
    if (copiedSalt.byteLength > 0) copiedSalt.fill(0);
  }
}

async function deriveVaultUnlockKeyInline(secret: string, salt: Uint8Array, parameters: Argon2idParameters): Promise<Uint8Array> {
  const key = await argon2id({
    password: secret.normalize("NFKC"),
    salt,
    parallelism: parameters.parallelism,
    iterations: parameters.iterations,
    memorySize: parameters.memoryKiB,
    hashLength: parameters.outputBytes,
    outputType: "binary"
  });
  if (typeof key === "string") throw new Error("Argon2id did not return binary key material.");
  return key;
}

function usesDefaultParameters(parameters: Argon2idParameters): boolean {
  return parameters.memoryKiB === ARGON2_MEMORY_KIB && parameters.iterations === ARGON2_ITERATIONS && parameters.parallelism === ARGON2_PARALLELISM && parameters.outputBytes === VAULT_UNLOCK_KEY_BYTES;
}

function throwIfCancelled(signal?: CancellationPort): void {
  if (signal?.aborted) throw new Error("Vault Unlock Key derivation was cancelled.");
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy;
}
