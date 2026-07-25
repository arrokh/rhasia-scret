import { describe, expect, it } from "vitest";
import { createEncryptedVaultExport, encryptPayload, generateSymmetricKey, openEncryptedVaultExport, serializeEncryptedEnvelope } from "@/modules/crypto";

describe("encrypted vault export", () => {
  it("creates a portable archive only an explicit archive key can open", async () => {
    const vaultKey = generateSymmetricKey();
    const archiveKey = generateSymmetricKey();
    const name = serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode("Personal")));
    const account = serializeEncryptedEnvelope(await encryptPayload(vaultKey, new Uint8Array([4, 5, 6])));
    const archive = await createEncryptedVaultExport(vaultKey, archiveKey, name, [account]);
    await expect(openEncryptedVaultExport(generateSymmetricKey(), archive)).rejects.toThrow("authentication");
    await expect(openEncryptedVaultExport(archiveKey, archive)).resolves.toEqual({ vaultName: "Personal", accounts: [new Uint8Array([4, 5, 6])] });
  });
});
