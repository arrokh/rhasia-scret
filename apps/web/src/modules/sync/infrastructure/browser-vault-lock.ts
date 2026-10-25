"use client";

import type { VaultLockPort } from "@rhasia-scret/client-vault-core";

const VAULT_LOCK_EVENT = "rhasia-scret:lock-local-vault";
let lockGeneration = 0;
let pwaUpdateLockActive = false;
export const pendingVaultSensitiveOperations = new Set<Promise<unknown>>();

export function requestLocalVaultLock(): void {
  lockGeneration += 1;
  window.dispatchEvent(new Event(VAULT_LOCK_EVENT));
}

export function beginPwaUpdateLock(): void {
  if (pwaUpdateLockActive) return;
  pwaUpdateLockActive = true;
  requestLocalVaultLock();
}

export function cancelPwaUpdateLock(): void {
  pwaUpdateLockActive = false;
}

export function trackVaultSensitiveOperation<Result>(
  operation: () => Promise<Result>,
  clearStaleResult?: (result: Result) => void,
): Promise<Result> {
  if (pwaUpdateLockActive) return Promise.reject(new Error());
  const generation = lockGeneration;
  const tracked = operation()
    .then((result) => {
      if (generation !== lockGeneration) {
        clearStaleResult?.(result);
        throw new Error();
      }
      return result;
    })
    .finally(() => pendingVaultSensitiveOperations.delete(tracked));
  pendingVaultSensitiveOperations.add(tracked);
  return tracked;
}

export function subscribeToLocalVaultLock(listener: () => void): () => void {
  window.addEventListener(VAULT_LOCK_EVENT, listener);
  return () => window.removeEventListener(VAULT_LOCK_EVENT, listener);
}

export const browserVaultLockPort: VaultLockPort = {
  requestLock: requestLocalVaultLock,
  subscribe: subscribeToLocalVaultLock,
};
