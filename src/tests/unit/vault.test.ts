import { describe, expect, it } from "vitest";
import { Vault } from "@/modules/vault-management";

describe("Vault", () => {
  it("does not allow an uninitialized Personal Vault to hold accounts", () => {
    const vault = new Vault("vault-1", "PERSONAL", "user-1", "UNINITIALIZED");
    expect(vault.canHoldAccounts()).toBe(false);
    expect(vault.canBeDeletedByOwner()).toBe(false);
  });

  it("rejects an uninitialized Shared Vault", () => {
    expect(() => new Vault("vault-1", "SHARED", "user-1", "UNINITIALIZED")).toThrow(
      "Only a Personal Vault may be uninitialized."
    );
  });
});
