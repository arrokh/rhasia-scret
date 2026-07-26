"use client";

const VAULT_LOCK_EVENT = "rhasia-scret:lock-local-vault";

export function requestLocalVaultLock(): void {
  window.dispatchEvent(new Event(VAULT_LOCK_EVENT));
}

export function subscribeToLocalVaultLock(listener: () => void): () => void {
  window.addEventListener(VAULT_LOCK_EVENT, listener);
  return () => window.removeEventListener(VAULT_LOCK_EVENT, listener);
}
