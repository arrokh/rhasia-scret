import { describe, expect, it } from "vitest";
import { createPasskeyRecoveryPackage, generateSymmetricKey, passkeyRecoverySalt, recoverUserRootKeyFromPasskeyPackage } from "@/modules/crypto";

describe("passkey recovery package", () => {
  it("requires the WebAuthn PRF output to recover a User Root Key", async () => {
    const rootKey = generateSymmetricKey();
    const prfOutput = generateSymmetricKey();
    const salt = new Uint8Array(32).fill(7);
    const packageBytes = await createPasskeyRecoveryPackage(rootKey, prfOutput, salt);
    expect(passkeyRecoverySalt(packageBytes)).toEqual(salt);
    await expect(recoverUserRootKeyFromPasskeyPackage(generateSymmetricKey(), packageBytes)).rejects.toThrow("authentication");
    await expect(recoverUserRootKeyFromPasskeyPackage(prfOutput, packageBytes)).resolves.toEqual({ userRootKey: rootKey, prfSalt: salt });
  });

  it("rejects malformed, oversized, or non-32-byte key material", async () => {
    await expect(createPasskeyRecoveryPackage(Uint8Array.of(1), generateSymmetricKey(), generateSymmetricKey())).rejects.toThrow(/32 bytes/);
    expect(() => passkeyRecoverySalt(new Uint8Array(4097))).toThrow(/invalid/);
    const malformed = new TextEncoder().encode(JSON.stringify({ version: 1, prfSalt: "AQ==", encryptedRecoveryWrappingKey: "AQ==", encryptedUserRootKey: "AQ==", unexpected: true }));
    expect(() => passkeyRecoverySalt(malformed)).toThrow(/invalid/);
  });
});
