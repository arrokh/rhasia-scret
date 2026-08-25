import { describe, expect, it } from "vitest";
import { vaultAuditEventMessageKey } from "@/modules/audit/presentation/vault-audit-history";

describe("Vault Audit History archive labels", () => {
  it("maps archive audit events to stable localization keys", () => {
    expect(vaultAuditEventMessageKey("ARCHIVE_EXPORTED")).toBe("archiveExported");
    expect(vaultAuditEventMessageKey("ARCHIVE_IMPORTED")).toBe("archiveImported");
    expect(vaultAuditEventMessageKey("ACCOUNT_COPIED_FROM_LOCAL")).toBe("accountCopiedFromLocal");
    expect(vaultAuditEventMessageKey("ACCOUNT_COPIED_TO_LOCAL")).toBe("accountCopiedToLocal");
    expect(vaultAuditEventMessageKey("UNKNOWN_SECURITY_ACTIVITY")).toBe("securityActivity");
  });
});
