import { describe, expect, it } from "vitest";
import { encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "@/modules/crypto";
import { parseTotpUri } from "@/modules/otp-runtime";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { rfcTotpUri } from "../otp-runtime/totp-test-helpers";
import {
  decryptAccountConfiguration,
  encryptAccountConfiguration,
  isDuplicateAccount,
  parseDecryptedAccountPayload,
  serializeDecryptedAccountPayload,
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

  it("reads legacy payloads without tags and writes bounded tags in account payload version two", () => {
    const legacy = configuration();
    const legacyPlaintext = new TextEncoder().encode(
      JSON.stringify({
        issuer: legacy.issuer,
        accountName: legacy.accountName,
        secret: bytesToBase64(legacy.secret),
        algorithm: legacy.algorithm,
        digits: legacy.digits,
        period: legacy.period,
      }),
    );
    const tagged = { ...configuration(), tags: ["Work", "Recovery"] };
    const taggedPlaintext = serializeDecryptedAccountPayload(tagged);

    try {
      const parsedLegacy = parseDecryptedAccountPayload(legacyPlaintext);
      expect(parsedLegacy).not.toHaveProperty("tags");
      parsedLegacy.secret.fill(0);
      expect(JSON.parse(new TextDecoder().decode(taggedPlaintext))).toMatchObject({
        version: 2,
        tags: ["Work", "Recovery"],
      });
      const parsedTagged = parseDecryptedAccountPayload(taggedPlaintext);
      expect(parsedTagged.tags).toEqual(["Work", "Recovery"]);
      parsedTagged.secret.fill(0);
    } finally {
      legacy.secret.fill(0);
      tagged.secret.fill(0);
      legacyPlaintext.fill(0);
      taggedPlaintext.fill(0);
    }
  });

  it("detects duplicates locally and derives alphabetical account order", () => {
    const first = configuration();
    const second = { ...configuration(), issuer: "Another", accountName: "bob" };
    expect(isDuplicateAccount(first, [first])).toBe(true);
    expect(sortAccounts([first, second]).map((account) => account.issuer)).toEqual(["Another", "Example"]);
  });

  it("rejects a legacy context-free account envelope outside the explicit workspace migration path", async () => {
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
      await expect(decryptAccountConfiguration(vaultKey, encrypted)).rejects.toThrow(
        "Legacy account payload requires explicit migration.",
      );
    } finally {
      plaintext.fill(0);
      vaultKey.fill(0);
      legacy.secret.fill(0);
    }
  });
});
