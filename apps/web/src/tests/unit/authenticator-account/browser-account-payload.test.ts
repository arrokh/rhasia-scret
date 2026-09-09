import { describe, expect, it } from "vitest";
import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { parseTotpUri } from "@/modules/otp-runtime";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { rfcTotpUri } from "../otp-runtime/totp-test-helpers";
import {
  decryptAccountConfiguration,
  encryptAccountConfiguration,
  isDuplicateAccount,
  sortAccounts,
} from "@/modules/authenticator-account/infrastructure/browser-account-payload";

const configuration = () => parseTotpUri(rfcTotpUri());

describe("browser account payload", () => {
  it("encrypts and decrypts a normalized account only with the Vault Encryption Key", async () => {
    const key = generateSymmetricKey();
    const encrypted = await encryptAccountConfiguration(key, configuration());
    await expect(decryptAccountConfiguration(key, encrypted)).resolves.toMatchObject({
      issuer: "Example",
      accountName: "alice",
    });
    await expect(decryptAccountConfiguration(generateSymmetricKey(), encrypted)).rejects.toThrow(
      "authentication failed",
    );
  });

  it("detects duplicates locally and derives alphabetical account order", () => {
    const first = configuration();
    const second = { ...configuration(), issuer: "Another", accountName: "bob" };
    expect(isDuplicateAccount(first, [first])).toBe(true);
    expect(sortAccounts([first, second]).map((account) => account.issuer)).toEqual(["Another", "Example"]);
  });

  it("reads a legacy context-free account envelope during the explicit unlock migration path", async () => {
    const vaultKey = generateSymmetricKey();
    const legacy = {
      issuer: "Legacy Issuer",
      accountName: "legacy@example.test",
      secret: Uint8Array.of(1, 2, 3, 4),
      algorithm: "SHA-1" as const,
      digits: 6 as const,
      period: 30,
    };
    const plaintext = new TextEncoder().encode(JSON.stringify({ ...legacy, secret: bytesToBase64(legacy.secret) }));
    try {
      const encrypted = serializeEncryptedEnvelope(await encryptPayload(vaultKey, plaintext));
      await expect(decryptAccountConfiguration(vaultKey, encrypted)).resolves.toEqual(legacy);
    } finally {
      plaintext.fill(0);
      vaultKey.fill(0);
      legacy.secret.fill(0);
    }
  });
});
