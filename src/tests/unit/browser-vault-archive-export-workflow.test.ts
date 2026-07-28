import { describe, expect, it } from "vitest";
import { parseDecryptedAccountPayload, serializeDecryptedAccountPayload } from "@/modules/authenticator-account";
import { openEncryptedVaultExport } from "@/modules/crypto";
import {
  clearPreparedVaultArchive,
  prepareEncryptedVaultArchive
} from "@/modules/vault-archive/infrastructure/browser-vault-archive-export-workflow";

const account = {
  id: "account-1",
  vaultId: "vault-1",
  vaultName: "Personal",
  vaultType: "PERSONAL" as const,
  revision: 1,
  issuer: "Example",
  accountName: "alice@example.test",
  secret: new Uint8Array([1, 2, 3, 4]),
  algorithm: "SHA-1" as const,
  digits: 6 as const,
  period: 30
};

const ownerVault = { id: "vault-1", name: "Personal", type: "PERSONAL" as const, role: "OWNER" as const };

describe("Vault archive export workflow", () => {
  it("serializes normalized account payloads canonically", () => {
    const plaintext = serializeDecryptedAccountPayload(account);
    expect(parseDecryptedAccountPayload(plaintext)).toEqual(expect.objectContaining({ issuer: "Example", accountName: "alice@example.test", secret: new Uint8Array([1, 2, 3, 4]) }));
    plaintext.fill(0);
  });

  it("prepares a V1 archive with a separate random key and generic filename", async () => {
    const prepared = await prepareEncryptedVaultArchive(ownerVault, [account], new Date("2026-07-27T12:00:00.000Z"));
    expect(prepared.filename).toBe("rhasia-vault-2026-07-27.rhasia-vault");
    expect(prepared.key).toHaveLength(32);
    expect(prepared.keyMaterial).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const opened = await openEncryptedVaultExport(prepared.key, prepared.archive);
    expect(opened.vaultName).toBe("Personal");
    expect(parseDecryptedAccountPayload(opened.accounts[0]!)).toEqual(expect.objectContaining({ issuer: "Example", accountName: "alice@example.test" }));
    for (const payload of opened.accounts) payload.fill(0);
    clearPreparedVaultArchive(prepared);
    expect(prepared.archive.every((byte) => byte === 0)).toBe(true);
    expect(prepared.key.every((byte) => byte === 0)).toBe(true);
    expect(prepared.keyMaterial).toBe("");
  });

  it("rejects Viewer exports, mixed-Vault accounts, and more than 500 accounts", async () => {
    await expect(prepareEncryptedVaultArchive({ ...ownerVault, role: "VIEWER" }, [account])).rejects.toMatchObject({ code: "owner_required" });
    await expect(prepareEncryptedVaultArchive(ownerVault, [{ ...account, vaultId: "other-vault" }])).rejects.toMatchObject({ code: "account_mismatch" });
    await expect(prepareEncryptedVaultArchive(ownerVault, Array.from({ length: 501 }, (_, index) => ({ ...account, id: `account-${index}` })))).rejects.toMatchObject({ code: "too_large" });
  });
});
