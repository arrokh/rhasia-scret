import { argon2id } from "hash-wasm";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  VAULT_UNLOCK_KEY_BYTES
} from "./vault-unlock-key-parameters";

type DerivationRequest = { password: ArrayBuffer; salt: ArrayBuffer };
type DerivationResponse = { ok: true; key: ArrayBuffer } | { ok: false };

self.onmessage = async (event: MessageEvent<DerivationRequest>) => {
  // Dedicated-worker messages may have an empty origin; reject explicit foreign origins.
  if (event.origin && event.origin !== self.location.origin) return;
  const password = new Uint8Array(event.data.password);
  const salt = new Uint8Array(event.data.salt);
  try {
    const key = await argon2id({
      password,
      salt,
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_ITERATIONS,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: VAULT_UNLOCK_KEY_BYTES,
      outputType: "binary"
    });
    if (typeof key === "string") throw new Error("Argon2id did not return binary key material.");
    const response: DerivationResponse = { ok: true, key: key.buffer as ArrayBuffer };
    self.postMessage(response, { transfer: [response.key] });
  } catch {
    const response: DerivationResponse = { ok: false };
    self.postMessage(response);
  } finally {
    password.fill(0);
    salt.fill(0);
  }
};
