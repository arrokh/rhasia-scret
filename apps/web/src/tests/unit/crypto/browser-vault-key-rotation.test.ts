import { describe, expect, it } from "vitest";
import {
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  encryptPayloadWithContext,
  generateSymmetricKey,
  rotateVaultKey,
  serializeEncryptedEnvelope,
} from "@/modules/crypto";

describe("rotateVaultKey", () => {
  it("re-encrypts vault ciphertext under a fresh client-only key", async () => {
    const oldKey = generateSymmetricKey();
    const nameContext = { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 } as const;
    const accountContext = {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      keyVersion: 1,
    } as const;
    const name = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(oldKey, new TextEncoder().encode("Personal"), nameContext),
    );
    const accountPayload = new TextEncoder().encode(
      JSON.stringify({
        issuer: "Example Issuer",
        accountName: "demo@example.invalid",
        secret: "AQID",
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
      }),
    );
    const account = serializeEncryptedEnvelope(await encryptPayloadWithContext(oldKey, accountPayload, accountContext));
    const rotated = await rotateVaultKey(oldKey, { encryptedName: name, encryptedAccounts: [account] });
    expect(rotated.vaultKey).not.toEqual(oldKey);
    await expect(
      decryptPayloadWithContext(oldKey, deserializeEncryptedEnvelope(rotated.encryptedName), nameContext),
    ).rejects.toThrow("authentication");
    await expect(
      decryptPayloadWithContext(rotated.vaultKey, deserializeEncryptedEnvelope(rotated.encryptedName), nameContext),
    ).resolves.toEqual(new TextEncoder().encode("Personal"));
    await expect(
      decryptPayloadWithContext(
        rotated.vaultKey,
        deserializeEncryptedEnvelope(rotated.encryptedAccounts[0]),
        accountContext,
      ),
    ).resolves.toEqual(accountPayload);
  });

  it("rejects malformed account payloads instead of encrypting them under the new key", async () => {
    const oldKey = generateSymmetricKey();
    const nameContext = { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 } as const;
    const accountContext = {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      keyVersion: 1,
    } as const;
    const name = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(oldKey, new TextEncoder().encode("Example Vault"), nameContext),
    );
    const malformedAccount = serializeEncryptedEnvelope(
      await encryptPayloadWithContext(oldKey, new Uint8Array([1, 2, 3]), accountContext),
    );

    await expect(
      rotateVaultKey(oldKey, { encryptedName: name, encryptedAccounts: [malformedAccount] }),
    ).rejects.toThrow("Encrypted account payload is invalid.");
  });
});
