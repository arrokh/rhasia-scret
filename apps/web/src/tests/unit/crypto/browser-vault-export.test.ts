import { describe, expect, it } from "vitest";
import {
  createEncryptedVaultExport,
  encryptPayloadWithContext,
  generateSymmetricKey,
  openEncryptedVaultExport,
  serializeEncryptedEnvelope,
} from "@/modules/crypto";

describe("encrypted vault export", () => {
  it("creates a portable archive only an explicit archive key can open", async () => {
    const vaultKey = generateSymmetricKey();
    const archiveKey = generateSymmetricKey();
    const name = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(vaultKey, new TextEncoder().encode("Personal"), {
        purpose: "vault-name",
        payloadType: "vault-name",
        keyVersion: 1,
      }),
    );
    const account = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(vaultKey, new Uint8Array([4, 5, 6]), {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        keyVersion: 1,
      }),
    );
    const archive = await createEncryptedVaultExport(vaultKey, archiveKey, name, [account]);
    await expect(openEncryptedVaultExport(generateSymmetricKey(), archive)).rejects.toThrow("authentication");
    await expect(openEncryptedVaultExport(archiveKey, archive)).resolves.toEqual({
      vaultName: "Personal",
      accounts: [new Uint8Array([4, 5, 6])],
    });
  });
});
