import { describe, expect, it } from "vitest";
import {
  accountDirectoryAccountKey,
  moveDirectoryAccount,
  orderDirectoryAccounts,
  parseAccountDirectoryPreferences,
} from "@/modules/authenticator-account/presentation/account-directory-preferences";

describe("account directory preferences", () => {
  const accounts = [
    { vaultId: "vault-a", id: "account-a", label: "A" },
    { vaultId: "vault-b", id: "account-b", label: "B" },
    { vaultId: "vault-a", id: "account-c", label: "C" },
  ];

  it("applies saved opaque account order and appends new accounts", () => {
    expect(orderDirectoryAccounts(accounts, ["vault-a:account-c", "stale:account"])).toEqual([
      accounts[2],
      accounts[0],
      accounts[1],
    ]);
  });

  it("moves an account before the target without changing the other keys", () => {
    const keys = accounts.map(accountDirectoryAccountKey);
    expect(moveDirectoryAccount(keys, "vault-a:account-a", "vault-a:account-c")).toEqual([
      "vault-b:account-b",
      "vault-a:account-a",
      "vault-a:account-c",
    ]);
  });

  it("ignores a source key that did not come from the current account list", () => {
    const keys = accounts.map(accountDirectoryAccountKey);
    expect(moveDirectoryAccount(keys, "other-vault:attacker-key", "vault-a:account-c")).toBe(keys);
  });

  it("parses multiple selected vaults and migrates the previous single-filter shape", () => {
    expect(
      parseAccountDirectoryPreferences(
        JSON.stringify({
          view: "wide",
          vaultFilters: ["vault-a", "vault-b", "vault-a", 42],
          order: ["vault-a:account-a"],
        }),
      ),
    ).toEqual({ view: "wide", vaultFilters: ["vault-a", "vault-b"], order: ["vault-a:account-a"] });
    expect(parseAccountDirectoryPreferences(JSON.stringify({ vaultFilter: "vault-b" })).vaultFilters).toEqual([
      "vault-b",
    ]);
    expect(parseAccountDirectoryPreferences(JSON.stringify({ vaultFilter: "ALL" })).vaultFilters).toEqual([]);
  });
});
