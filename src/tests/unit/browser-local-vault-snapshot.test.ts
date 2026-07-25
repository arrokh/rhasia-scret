import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEncryptedLocalVaultSnapshot, reconcileEncryptedLocalVaultSnapshot, removeAllEncryptedLocalVaultSnapshots, removeEncryptedLocalVaultSnapshot, saveEncryptedLocalVaultSnapshot } from "@/modules/crypto";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { get length() { return store.size; }, key: (index: number) => [...store.keys()][index] ?? null, getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
const snapshot = (vaultId: string) => ({ vaultId, encryptedName: "ciphertext", encryptedVaultKey: "ciphertext", accounts: [{ id: "account-1", encryptedPayload: "ciphertext", encryptionVersion: 1, revision: 1 }], synchronizedAt: "2026-01-01T00:00:00.000Z" });

describe("encrypted local vault snapshots", () => {
  beforeEach(() => store.clear());
  it("stores and removes only encrypted snapshot material", () => {
    saveEncryptedLocalVaultSnapshot(snapshot("vault-1"));
    expect(loadEncryptedLocalVaultSnapshot("vault-1")?.accounts).toHaveLength(1);
    removeEncryptedLocalVaultSnapshot("vault-1");
    expect(loadEncryptedLocalVaultSnapshot("vault-1")).toBeNull();
  });
  it("removes revoked snapshots and clears all device-local snapshots on device removal", () => {
    saveEncryptedLocalVaultSnapshot(snapshot("vault-1"));
    saveEncryptedLocalVaultSnapshot(snapshot("vault-2"));
    reconcileEncryptedLocalVaultSnapshot("vault-1", false);
    expect(loadEncryptedLocalVaultSnapshot("vault-1")).toBeNull();
    removeAllEncryptedLocalVaultSnapshots();
    expect(loadEncryptedLocalVaultSnapshot("vault-2")).toBeNull();
  });
});
