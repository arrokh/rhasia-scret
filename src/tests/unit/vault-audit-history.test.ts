import { describe, expect, it } from "vitest";
import { vaultAuditEventLabel } from "@/modules/vault-management/presentation/vault-audit-history";

describe("Vault Audit History labels", () => {
  it("renders localized archive action labels", () => {
    expect(vaultAuditEventLabel("ARCHIVE_EXPORTED")).toBe("Arsip Brankas diekspor");
    expect(vaultAuditEventLabel("ARCHIVE_IMPORTED")).toBe("Arsip Brankas diimpor");
  });
});
