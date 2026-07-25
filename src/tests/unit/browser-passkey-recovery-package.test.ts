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
});
