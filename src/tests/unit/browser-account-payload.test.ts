import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "@/modules/crypto";
import { parseTotpUri } from "@/modules/otp-runtime";
import { rfcTotpUri } from "./totp-test-helpers";
import { decryptAccountConfiguration, encryptAccountConfiguration, isDuplicateAccount, sortAccounts } from "@/modules/authenticator-account/infrastructure/browser-account-payload";

const configuration = () => parseTotpUri(rfcTotpUri());

describe("browser account payload", () => {
  it("encrypts and decrypts a normalized account only with the Vault Encryption Key", async () => {
    const key = generateSymmetricKey();
    const encrypted = await encryptAccountConfiguration(key, configuration());
    await expect(decryptAccountConfiguration(key, encrypted)).resolves.toMatchObject({ issuer: "Example", accountName: "alice" });
    await expect(decryptAccountConfiguration(generateSymmetricKey(), encrypted)).rejects.toThrow("authentication failed");
  });

  it("detects duplicates locally and derives alphabetical account order", () => {
    const first = configuration();
    const second = { ...configuration(), issuer: "Another", accountName: "bob" };
    expect(isDuplicateAccount(first, [first])).toBe(true);
    expect(sortAccounts([first, second]).map((account) => account.issuer)).toEqual(["Another", "Example"]);
  });
});
