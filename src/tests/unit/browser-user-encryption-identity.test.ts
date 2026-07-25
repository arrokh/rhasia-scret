import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "@/modules/crypto/infrastructure/browser-crypto-envelope";
import { createUserEncryptionIdentity, recoverUserEncryptionPrivateKey } from "@/modules/crypto/infrastructure/browser-user-encryption-identity";

describe("user encryption identity", () => {
  it("backs up a private ECDH key encrypted under the User Root Key", async () => {
    const rootKey = generateSymmetricKey();
    const identity = await createUserEncryptionIdentity(rootKey);
    expect(identity.publicKey.kty).toBe("EC");
    await expect(recoverUserEncryptionPrivateKey(rootKey, identity.encryptedPrivateKey)).resolves.toMatchObject({ kty: "EC", d: expect.any(String) });
    await expect(recoverUserEncryptionPrivateKey(generateSymmetricKey(), identity.encryptedPrivateKey)).rejects.toThrow("authentication failed");
  });
});
