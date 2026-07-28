import { describe, expect, it } from "vitest";
import { decryptAccountConfiguration } from "@/modules/authenticator-account";
import {
  createEncryptedVaultExport,
  encryptPayload,
  generateSymmetricKey,
  MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES,
  serializeEncryptedEnvelope
} from "@/modules/crypto";
import {
  clearOpenedVaultArchive,
  countDuplicateArchiveAccounts,
  encryptVaultArchiveAccounts,
  openAndValidateEncryptedVaultArchive
} from "@/modules/vault-archive/infrastructure/browser-vault-archive-workflow";

const configuration = { issuer: "Example", accountName: "alice@example.test", secret: new Uint8Array([1, 2, 3, 4]), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };

describe("encrypted Vault archive browser workflow", () => {
  it("opens only the supported version with the correct key and validates normalized accounts", async () => {
    const { archive, archiveKey } = await createArchive(accountPayload(configuration));
    const opened = await openAndValidateEncryptedVaultArchive(archiveKey, archive);
    expect(opened.vaultName).toBe("Imported Vault");
    expect(opened.accounts).toEqual([configuration]);
    clearOpenedVaultArchive(opened);
    expect(configuration.secret).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects authentication failure, corruption, unsupported versions, and malformed payloads", async () => {
    const valid = await createArchive(accountPayload(configuration));
    await expect(openAndValidateEncryptedVaultArchive(generateSymmetricKey(), valid.archive)).rejects.toThrow("authentication");
    const corrupt = valid.archive.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(openAndValidateEncryptedVaultArchive(valid.archiveKey, corrupt)).rejects.toThrow("authentication");

    const unsupportedEnvelope = valid.archive.slice();
    unsupportedEnvelope[0] = 2;
    await expect(openAndValidateEncryptedVaultArchive(valid.archiveKey, unsupportedEnvelope)).rejects.toThrow("Unsupported");
    const unsupported = await encryptedRawArchive(valid.archiveKey, { version: 2, vaultName: "Imported Vault", accounts: [] });
    await expect(openAndValidateEncryptedVaultArchive(valid.archiveKey, unsupported)).rejects.toThrow("invalid");
    const malformed = await createArchive(new TextEncoder().encode("not-json"));
    await expect(openAndValidateEncryptedVaultArchive(malformed.archiveKey, malformed.archive)).rejects.toThrow("payload is invalid");
  });

  it("rejects unsupported TOTP configurations and oversized archives", async () => {
    const unsupported = await createArchive(accountPayload({ ...configuration, algorithm: "MD5" }));
    await expect(openAndValidateEncryptedVaultArchive(unsupported.archiveKey, unsupported.archive)).rejects.toThrow("payload is invalid");
    await expect(openAndValidateEncryptedVaultArchive(generateSymmetricKey(), new Uint8Array(MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES + 1))).rejects.toThrow("archiveTooLarge");
  });

  it("warns for destination and within-archive duplicates", () => {
    const duplicate = { ...configuration, secret: configuration.secret.slice() };
    expect(countDuplicateArchiveAccounts([configuration, duplicate], [duplicate])).toBe(2);
    expect(countDuplicateArchiveAccounts([configuration], [])).toBe(0);
  });

  it("re-encrypts imported configurations only under the destination Vault key", async () => {
    const destinationKey = generateSymmetricKey();
    const wrongKey = generateSymmetricKey();
    const encrypted = await encryptVaultArchiveAccounts(destinationKey, [configuration]);
    await expect(decryptAccountConfiguration(destinationKey, encrypted[0])).resolves.toEqual(configuration);
    await expect(decryptAccountConfiguration(wrongKey, encrypted[0])).rejects.toThrow("authentication");
    encrypted[0].fill(0);
  });
});

async function createArchive(accountPlaintext: Uint8Array) {
  const vaultKey = generateSymmetricKey();
  const archiveKey = generateSymmetricKey();
  const encryptedName = serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode("Imported Vault")));
  const encryptedAccount = serializeEncryptedEnvelope(await encryptPayload(vaultKey, accountPlaintext));
  return { archiveKey, archive: await createEncryptedVaultExport(vaultKey, archiveKey, encryptedName, [encryptedAccount]) };
}

async function encryptedRawArchive(key: Uint8Array, payload: unknown): Promise<Uint8Array> {
  return serializeEncryptedEnvelope(await encryptPayload(key, new TextEncoder().encode(JSON.stringify(payload))));
}

function accountPayload(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    issuer: value.issuer,
    accountName: value.accountName,
    secret: btoa(String.fromCharCode(...(value.secret as Uint8Array))),
    algorithm: value.algorithm,
    digits: value.digits,
    period: value.period
  }));
}
