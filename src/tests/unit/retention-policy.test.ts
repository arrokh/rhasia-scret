import { describe, expect, it } from "vitest";
import { accountPurgeAfter } from "@/modules/authenticator-account";
import { auditPurgeAfter, vaultPurgeAfter } from "@/modules/vault-management";

describe("retention deadlines", () => {
  it("sets account and Shared Vault recovery deadlines exactly 30 days after deletion", () => {
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(accountPurgeAfter(deletedAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(vaultPurgeAfter(deletedAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("sets audit retention to one calendar year, including leap-year boundaries", () => {
    expect(auditPurgeAfter(new Date("2024-02-29T12:00:00.000Z")).toISOString()).toBe("2025-03-01T12:00:00.000Z");
    expect(auditPurgeAfter(new Date("2026-07-26T12:00:00.000Z")).toISOString()).toBe("2027-07-26T12:00:00.000Z");
  });
});
