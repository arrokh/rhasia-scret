import { describe, expect, it } from "vitest";
import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, generateSymmetricKey, rotateVaultKey, serializeEncryptedEnvelope } from "@/modules/crypto";

describe("rotateVaultKey", () => {
  it("re-encrypts vault ciphertext under a fresh client-only key", async () => {
    const oldKey = generateSymmetricKey();
    const name = serializeEncryptedEnvelope(await encryptPayload(oldKey, new TextEncoder().encode("Personal")));
    const account = serializeEncryptedEnvelope(await encryptPayload(oldKey, new Uint8Array([1, 2, 3])));
    const rotated = await rotateVaultKey(oldKey, { encryptedName: name, encryptedAccounts: [account] });
    expect(rotated.vaultKey).not.toEqual(oldKey);
    await expect(decryptPayload(oldKey, deserializeEncryptedEnvelope(rotated.encryptedName))).rejects.toThrow("authentication");
    await expect(decryptPayload(rotated.vaultKey, deserializeEncryptedEnvelope(rotated.encryptedName))).resolves.toEqual(new TextEncoder().encode("Personal"));
    await expect(decryptPayload(rotated.vaultKey, deserializeEncryptedEnvelope(rotated.encryptedAccounts[0]))).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });
});
