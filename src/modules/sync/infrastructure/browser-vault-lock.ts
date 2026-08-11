"use client";

import type { VaultLockPort } from "../application/client-storage-ports";

const VAULT_LOCK_EVENT = "rhasia-scret:lock-local-vault";

export function requestLocalVaultLock(): void {
  window.dispatchEvent(new Event(VAULT_LOCK_EVENT));
}

export function subscribeToLocalVaultLock(listener: () => void): () => void {
  window.addEventListener(VAULT_LOCK_EVENT, listener);
  return () => window.removeEventListener(VAULT_LOCK_EVENT, listener);
}

export class BrowserVaultLockPort implements VaultLockPort {
  requestLock(): void {
    requestLocalVaultLock();
  }

  subscribe(listener: () => void): () => void {
    return subscribeToLocalVaultLock(listener);
  }
}

export const browserVaultLockPort = new BrowserVaultLockPort();
