import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEncryptedLocalVaultSnapshot, removeEncryptedLocalVaultSnapshot, saveEncryptedLocalVaultSnapshot } from "@/modules/crypto";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });

describe("encrypted local vault snapshots", () => {
  beforeEach(() => store.clear());
  it("stores and removes only encrypted snapshot material", () => {
    saveEncryptedLocalVaultSnapshot({ vaultId: "vault-1", encryptedName: "ciphertext", encryptedVaultKey: "ciphertext", accounts: [{ id: "account-1", encryptedPayload: "ciphertext", encryptionVersion: 1, revision: 1 }], synchronizedAt: "2026-01-01T00:00:00.000Z" });
    expect(loadEncryptedLocalVaultSnapshot("vault-1")?.accounts).toHaveLength(1);
    removeEncryptedLocalVaultSnapshot("vault-1");
    expect(loadEncryptedLocalVaultSnapshot("vault-1")).toBeNull();
  });
});
