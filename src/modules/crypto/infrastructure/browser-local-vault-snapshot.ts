"use client";

export type EncryptedLocalVaultSnapshot = {
  vaultId: string;
  encryptedName: string;
  encryptedVaultKey: string;
  accounts: Array<{ id: string; encryptedPayload: string; encryptionVersion: number; revision: number }>;
  synchronizedAt: string;
};

const prefix = "rhsia:encrypted-vault-snapshot:";

export function saveEncryptedLocalVaultSnapshot(snapshot: EncryptedLocalVaultSnapshot): void {
  localStorage.setItem(`${prefix}${snapshot.vaultId}`, JSON.stringify(snapshot));
}

export function loadEncryptedLocalVaultSnapshot(vaultId: string): EncryptedLocalVaultSnapshot | null {
  const raw = localStorage.getItem(`${prefix}${vaultId}`);
  if (!raw) return null;
  try {
    const snapshot: unknown = JSON.parse(raw);
    return isSnapshot(snapshot) ? snapshot : null;
  } catch { return null; }
}

export function removeEncryptedLocalVaultSnapshot(vaultId: string): void {
  localStorage.removeItem(`${prefix}${vaultId}`);
}

/** Remove every device-local snapshot on explicit sign-out or device removal. */
export function removeAllEncryptedLocalVaultSnapshots(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

/** A successful online authorization check removes a snapshot after revocation. */
export function reconcileEncryptedLocalVaultSnapshot(vaultId: string, authorized: boolean): void {
  if (!authorized) removeEncryptedLocalVaultSnapshot(vaultId);
}

function isSnapshot(value: unknown): value is EncryptedLocalVaultSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<EncryptedLocalVaultSnapshot>;
  return typeof snapshot.vaultId === "string" && typeof snapshot.encryptedName === "string" && typeof snapshot.encryptedVaultKey === "string" && typeof snapshot.synchronizedAt === "string" && Array.isArray(snapshot.accounts);
}
