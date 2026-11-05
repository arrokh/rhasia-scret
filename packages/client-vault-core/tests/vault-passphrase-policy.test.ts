import { describe, expect, it } from "vitest";
import { validateNewVaultUnlockSecret, validateVaultUnlockSecret } from "../src";

describe("Vault Passphrase creation policy", () => {
  it("requires twelve trimmed Unicode code points for new user-authored secrets", () => {
    expect(() => validateNewVaultUnlockSecret("short")).toThrow("at least twelve characters");
    expect(() => validateNewVaultUnlockSecret("  abcdefghijk😀  ")).not.toThrow();
  });

  it("keeps the former minimum available to decrypt existing Vaults", () => {
    expect(() => validateVaultUnlockSecret("abc")).not.toThrow();
  });
});
