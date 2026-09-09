import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { serializeDecryptedAccountPayload } from "@/modules/authenticator-account";
import { createEncryptedVaultArchive, generateSymmetricKey } from "@/modules/crypto";
import { openAndValidateEncryptedVaultArchive } from "@/modules/vault-archive/infrastructure/browser-vault-archive-workflow";
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
  renameLocalVault,
  unlockLocalVault,
  updateLocalAccount,
} from "@/modules/local-vault";

function account() {
  return {
    issuer: "Example",
    accountName: "alice@example.com",
    secret: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    algorithm: "SHA-1" as const,
    digits: 6 as const,
    period: 30,
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

    expect(() =>
      parseLocalVaultRecord({
        ...record,
        accounts: [{ id: "plaintext", encryptedPayload: "secret", encryptionVersion: 1, revision: 1 }],
      }),
    ).toThrow();
    clearUnlockedLocalVault(unlocked);
    expect(unlocked.rootKey.every((byte) => byte === 0)).toBe(true);
    expect(unlocked.vaultKey.every((byte) => byte === 0)).toBe(true);
  });

  it("renames the Local Vault through its encrypted name envelope", async () => {
    const record = await createLocalVault("local-passphrase", "Device vault");
    const repository = new BrowserLocalVaultRepository();
    await repository.create(record);
    const unlocked = await unlockLocalVault(record, "local-passphrase");

    await renameLocalVault(unlocked, "Renamed device vault");
    expect(unlocked.name).toBe("Renamed device vault");
    const persisted = await repository.read();
    expect(persisted?.encryptedVaultName).not.toBe(record.encryptedVaultName);

    const reopened = await unlockLocalVault(persisted!, "local-passphrase");
    expect(reopened.name).toBe("Renamed device vault");
    clearUnlockedLocalVault(reopened);
    clearUnlockedLocalVault(unlocked);
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

  it("keeps Local and hosted encrypted archives interoperable", async () => {
    const record = await createLocalVault("local-passphrase", "Device vault");
    await new BrowserLocalVaultRepository().create(record);
    const unlocked = await unlockLocalVault(record, "local-passphrase");
    await addLocalAccount(unlocked, account());

    const localExport = await exportLocalVault(unlocked);
    const hostedPreview = await openAndValidateEncryptedVaultArchive(localExport.key, localExport.archive);
    expect(hostedPreview.vaultName).toBe("Device vault");
    expect(hostedPreview.accounts).toHaveLength(1);
    for (const value of hostedPreview.accounts) value.secret.fill(0);
    localExport.key.fill(0);

    await clearLocalVault();
    clearUnlockedLocalVault(unlocked);
    const emptyRecord = await createLocalVault("local-passphrase", "Empty device vault");
    await new BrowserLocalVaultRepository().create(emptyRecord);
    const emptyVault = await unlockLocalVault(emptyRecord, "local-passphrase");
    const hostedKey = generateSymmetricKey();
    const plaintext = serializeDecryptedAccountPayload(account());
    try {
      const hostedArchive = await createEncryptedVaultArchive(hostedKey, "Hosted vault", [plaintext]);
      expect(await importLocalVaultArchive(emptyVault, hostedKey, hostedArchive)).toBe(1);
      expect(emptyVault.accounts).toHaveLength(0);
      const refreshed = await unlockLocalVault((await new BrowserLocalVaultRepository().read())!, "local-passphrase");
      expect(refreshed.accounts).toHaveLength(1);
      expect(refreshed.accounts[0]).toMatchObject({ issuer: "Example", accountName: "alice@example.com" });
      clearUnlockedLocalVault(refreshed);
    } finally {
      plaintext.fill(0);
      hostedKey.fill(0);
      clearUnlockedLocalVault(emptyVault);
    }
  }, 30_000);
});
