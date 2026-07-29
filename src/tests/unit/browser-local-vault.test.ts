import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BrowserLocalVaultRepository,
  addLocalAccount,
  clearLocalVault,
  clearUnlockedLocalVault,
  createLocalVault,
  deleteLocalAccount,
  exportLocalVault,
  importLocalVaultArchive,
  parseLocalVaultRecord,
  previewLocalVaultArchive,
  unlockLocalVault,
  updateLocalAccount
} from "@/modules/local-vault";

function account() {
  return {
    issuer: "Example",
    accountName: "alice@example.com",
    secret: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    algorithm: "SHA-1" as const,
    digits: 6 as const,
    period: 30
  };
}

describe("device-local Local Vault", () => {
  beforeEach(async () => {
    await clearLocalVault();
  });

  it("creates one encrypted profile, unlocks offline, and rejects a second profile", async () => {
    const record = await createLocalVault("local-passphrase", "Device vault");
    expect(record).not.toHaveProperty("name");
    expect(record).not.toHaveProperty("passphrase");
    await new BrowserLocalVaultRepository().create(record);

    await expect(new BrowserLocalVaultRepository().create(record)).rejects.toThrow(/already exists/);
    await expect(unlockLocalVault(record, "wrong-passphrase")).rejects.toThrow(/authentication failed/);
    const unlocked = await unlockLocalVault(record, "local-passphrase");
    expect(unlocked.name).toBe("Device vault");
    expect(unlocked.accounts).toEqual([]);
    clearUnlockedLocalVault(unlocked);
  });

  it("atomically persists CRUD, duplicate detection, lock disposal, and malformed-record rejection", async () => {
    const record = await createLocalVault("local-passphrase", "Device vault");
    const repository = new BrowserLocalVaultRepository();
    await repository.create(record);
    const unlocked = await unlockLocalVault(record, "local-passphrase");

    await addLocalAccount(unlocked, account());
    expect(unlocked.accounts).toHaveLength(1);
    await expect(addLocalAccount(unlocked, account())).rejects.toThrow(/duplicate/);
    const id = unlocked.accounts[0]!.id;
    await updateLocalAccount(unlocked, id, { ...account(), accountName: "renamed@example.com" });
    expect(unlocked.accounts[0]!.accountName).toBe("renamed@example.com");
    await deleteLocalAccount(unlocked, id);
    expect(unlocked.accounts).toHaveLength(0);

    expect(() => parseLocalVaultRecord({ ...record, accounts: [{ id: "plaintext", encryptedPayload: "secret", encryptionVersion: 1, revision: 1 }] })).toThrow();
    clearUnlockedLocalVault(unlocked);
    expect(unlocked.rootKey.every((byte) => byte === 0)).toBe(true);
    expect(unlocked.vaultKey.every((byte) => byte === 0)).toBe(true);
  });

  it("round-trips an encrypted archive and imports only new accounts", async () => {
    const record = await createLocalVault("local-passphrase", "Device vault");
    const repository = new BrowserLocalVaultRepository();
    await repository.create(record);
    const unlocked = await unlockLocalVault(record, "local-passphrase");
    await addLocalAccount(unlocked, account());

    const exported = await exportLocalVault(unlocked);
    const preview = await previewLocalVaultArchive(exported.key, exported.archive);
    expect(preview.vaultName).toBe("Device vault");
    expect(preview.accounts).toHaveLength(1);
    for (const value of preview.accounts) value.secret.fill(0);
    expect(await importLocalVaultArchive(unlocked, exported.key, exported.archive)).toBe(0);
    exported.key.fill(0);
    clearUnlockedLocalVault(unlocked);
  });
});
