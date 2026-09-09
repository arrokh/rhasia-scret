import { describe, expect, it } from "vitest";
import {
  hasDuplicateImportedAccountIds,
  type EncryptedImportedAccount,
} from "@/modules/vault-archive/domain/encrypted-vault-import";

const account = (id: string): EncryptedImportedAccount => ({
  id,
  encryptedPayload: Uint8Array.of(1, 2, 3),
  encryptionVersion: 1,
});

describe("encrypted Vault archive import identifiers", () => {
  it("accepts distinct account identifiers", () => {
    expect(hasDuplicateImportedAccountIds([account("account-1"), account("account-2")])).toBe(false);
  });

  it("rejects repeated account identifiers before persistence", () => {
    expect(hasDuplicateImportedAccountIds([account("account-1"), account("account-1")])).toBe(true);
  });
});
