import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { serializeDecryptedAccountPayload } from "@/modules/authenticator-account";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { createEncryptedVaultArchive, deriveVaultUnlockKey, generateSymmetricKey } from "@/modules/crypto";
import { browserClientCryptoPort } from "@/modules/crypto/infrastructure/browser-client-crypto-port";
import { openAndValidateEncryptedVaultArchive } from "@/modules/vault-archive/infrastructure/browser-vault-archive-workflow";
import {
  BrowserLocalVaultRepository,
  addLocalAccount,
  clearLocalVault,
  clearUnlockedLocalVault,
  createLocalVault,
  deleteLocalAccount,
  LocalVaultMigrationRequiredError,
  migrateLegacyLocalVault,
  exportLocalVault,
  importLocalVaultArchive,
  parseLocalVaultRecord,
  type LocalVaultRecord,
  previewLocalVaultArchive,
  renameLocalVault,
  unlockLocalVault,
  updateLocalAccount,
} from "@/modules/local-vault";

function account() {
  return {
    issuer: "Example Issuer",
    accountName: "alice@example.invalid",
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

  it("atomically migrates every validated Local Vault payload and preserves data on failed unlock", async () => {
    const passphrase = "local-migration-passphrase";
    const created = await createLocalVault(passphrase, "Synthetic device vault");
    const repository = new BrowserLocalVaultRepository();
    await repository.create(created);
    const unlocked = await unlockLocalVault(created, passphrase);
    await addLocalAccount(unlocked, account());
    clearUnlockedLocalVault(unlocked);
    const v2Record = await repository.read();
    expect(v2Record).not.toBeNull();
    const legacyRecord = await legacyLocalVaultRecord(v2Record!, passphrase);
    await repository.replace(legacyRecord);

    await expect(unlockLocalVault(legacyRecord, passphrase)).rejects.toBeInstanceOf(LocalVaultMigrationRequiredError);
    await expect(migrateLegacyLocalVault("incorrect synthetic passphrase")).rejects.toThrow();
    expect(await repository.read()).toEqual(legacyRecord);

    const migrated = await migrateLegacyLocalVault(passphrase);
    const legacyEnvelopes = [
      legacyRecord.wrappedLocalRootKey,
      legacyRecord.encryptedLocalVaultKey,
      legacyRecord.encryptedVaultName,
      ...legacyRecord.accounts.map(({ encryptedPayload }) => encryptedPayload),
    ];
    const migratedEnvelopes = [
      migrated.wrappedLocalRootKey,
      migrated.encryptedLocalVaultKey,
      migrated.encryptedVaultName,
      ...migrated.accounts.map(({ encryptedPayload }) => encryptedPayload),
    ];
    for (const [index, ciphertext] of migratedEnvelopes.entries()) {
      const bytes = base64ToBytes(ciphertext);
      const oldNonce = envelopeNonce(legacyEnvelopes[index]!);
      const newNonce = envelopeNonce(ciphertext);
      try {
        expect(bytes[0]).toBe(2);
        expect(newNonce).not.toEqual(oldNonce);
      } finally {
        bytes.fill(0);
        oldNonce.fill(0);
        newNonce.fill(0);
      }
    }
    expect(await repository.read()).toEqual(migrated);
    expect(migrated).not.toEqual(legacyRecord);
    const reopened = await unlockLocalVault(migrated, passphrase);
    expect(reopened.name).toBe("Synthetic device vault");
    expect(reopened.accounts).toMatchObject([{ issuer: "Example Issuer", accountName: "alice@example.invalid" }]);
    expect([...reopened.accounts[0]!.secret]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    clearUnlockedLocalVault(reopened);

    const malformedPlaintext = new TextEncoder().encode("not-json");
    try {
      const malformedRecord = await legacyLocalVaultRecord(v2Record!, passphrase, malformedPlaintext);
      await repository.replace(malformedRecord);
      await expect(migrateLegacyLocalVault(passphrase)).rejects.toThrow();
      expect(await repository.read()).toEqual(malformedRecord);
    } finally {
      malformedPlaintext.fill(0);
    }
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
      expect(refreshed.accounts[0]).toMatchObject({ issuer: "Example Issuer", accountName: "alice@example.invalid" });
      clearUnlockedLocalVault(refreshed);
    } finally {
      plaintext.fill(0);
      hostedKey.fill(0);
      clearUnlockedLocalVault(emptyVault);
    }
  }, 30_000);
});

async function legacyLocalVaultRecord(
  record: LocalVaultRecord,
  passphrase: string,
  accountPlaintextOverride?: Uint8Array,
): Promise<LocalVaultRecord> {
  const salt = base64ToBytes(record.kdf.salt);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  const nameBytes = new TextEncoder().encode("Synthetic device vault");
  const configuration = account();
  const accountPlaintext = accountPlaintextOverride?.slice() ?? serializeDecryptedAccountPayload(configuration);
  try {
    unlockKey = await deriveVaultUnlockKey(passphrase, salt);
    rootKey = await decryptV2Payload(unlockKey, record.wrappedLocalRootKey, {
      purpose: "local-root-key-wrap",
      payloadType: "local-root-key",
      profileId: record.profileId,
      keyVersion: 1,
    });
    vaultKey = await decryptV2Payload(rootKey, record.encryptedLocalVaultKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      profileId: record.profileId,
      keyVersion: 1,
    });
    const localVaultKey = vaultKey;
    return {
      ...record,
      wrappedLocalRootKey: await encryptLegacyPayload(unlockKey, rootKey),
      encryptedLocalVaultKey: await encryptLegacyPayload(rootKey, vaultKey),
      encryptedVaultName: await encryptLegacyPayload(vaultKey, nameBytes),
      accounts: await Promise.all(
        record.accounts.map(async (entry) => ({
          ...entry,
          encryptedPayload: await encryptLegacyPayload(localVaultKey, accountPlaintext),
        })),
      ),
    };
  } finally {
    salt.fill(0);
    unlockKey?.fill(0);
    rootKey?.fill(0);
    vaultKey?.fill(0);
    nameBytes.fill(0);
    configuration.secret.fill(0);
    accountPlaintext.fill(0);
  }
}

function envelopeNonce(encoded: string): Uint8Array {
  const ciphertext = base64ToBytes(encoded);
  let envelope: ReturnType<typeof browserClientCryptoPort.deserializeEncryptedEnvelope> | undefined;
  try {
    envelope = browserClientCryptoPort.deserializeEncryptedEnvelope(ciphertext);
    return envelope.nonce.slice();
  } finally {
    ciphertext.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

async function decryptV2Payload(
  key: Uint8Array,
  encoded: string,
  context: Parameters<typeof browserClientCryptoPort.decryptPayloadWithContext>[2],
): Promise<Uint8Array> {
  const ciphertext = base64ToBytes(encoded);
  let envelope: ReturnType<typeof browserClientCryptoPort.deserializeEncryptedEnvelope> | undefined;
  try {
    envelope = browserClientCryptoPort.deserializeEncryptedEnvelope(ciphertext);
    return await browserClientCryptoPort.decryptPayloadWithContext(key, envelope, context);
  } finally {
    ciphertext.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

async function encryptLegacyPayload(key: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const envelope = await browserClientCryptoPort.encryptPayload(key, plaintext);
  let serialized: Uint8Array | undefined;
  try {
    serialized = browserClientCryptoPort.serializeEncryptedEnvelope(envelope);
    return bytesToBase64(serialized);
  } finally {
    envelope.nonce.fill(0);
    envelope.ciphertext.fill(0);
    serialized?.fill(0);
  }
}
