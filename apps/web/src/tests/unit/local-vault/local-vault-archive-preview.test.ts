import { describe, expect, it, vi } from "vitest";
import { previewLocalVaultArchive } from "@/modules/local-vault/application/local-vault-workflow";

describe("Local Vault archive preview", () => {
  it("clears every decrypted payload when parsing one account fails", async () => {
    const parsedSecret = new Uint8Array([4, 5, 6]);
    const firstPayload = new Uint8Array([1]);
    const invalidPayload = new Uint8Array([2]);
    const unvisitedPayload = new Uint8Array([3]);
    const parseDecryptedAccountPayload = vi.fn((payload: Uint8Array) => {
      if (payload === invalidPayload) throw new Error("Synthetic account payload is invalid.");
      return {
        issuer: "Example Issuer",
        accountName: "sample@example.invalid",
        secret: parsedSecret,
        algorithm: "SHA-1" as const,
        digits: 6 as const,
        period: 30,
      };
    });
    const openEncryptedVaultExport = vi.fn(async () => ({
      vaultName: "Synthetic archive vault",
      accounts: [firstPayload, invalidPayload, unvisitedPayload],
    }));

    await expect(
      previewLocalVaultArchive(new Uint8Array(32), new Uint8Array([9]), {
        crypto: { openEncryptedVaultExport },
        accountPayload: { parseDecryptedAccountPayload },
      }),
    ).rejects.toThrow("Synthetic account payload is invalid.");

    expect([...firstPayload]).toEqual([0]);
    expect([...invalidPayload]).toEqual([0]);
    expect([...unvisitedPayload]).toEqual([0]);
    expect([...parsedSecret]).toEqual([0, 0, 0]);
    expect(parseDecryptedAccountPayload).toHaveBeenCalledTimes(2);
  });
});
