import { describe, expect, it } from "vitest";
import { matchesAuthenticatorAccountSearch } from "../src/modules/authenticator-account/domain/account-search";

describe("Authenticator Account search", () => {
  const account = { issuer: "Synthetic Service", accountName: "alice@example.test" };

  it("matches issuer and account name case-insensitively", () => {
    expect(matchesAuthenticatorAccountSearch(account, "synthetic")).toBe(true);
    expect(matchesAuthenticatorAccountSearch(account, "ALICE@EXAMPLE.TEST")).toBe(true);
    expect(matchesAuthenticatorAccountSearch(account, "example.test")).toBe(true);
  });

  it("trims the query and treats an empty query as unfiltered", () => {
    expect(matchesAuthenticatorAccountSearch(account, "  Synthetic  ")).toBe(true);
    expect(matchesAuthenticatorAccountSearch(account, "   ")).toBe(true);
  });

  it("does not match unrelated account fields", () => {
    expect(matchesAuthenticatorAccountSearch(account, "vault name")).toBe(false);
    expect(matchesAuthenticatorAccountSearch(account, "123456")).toBe(false);
  });
});
