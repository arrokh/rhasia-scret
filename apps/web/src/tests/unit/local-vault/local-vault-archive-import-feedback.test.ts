import { describe, expect, it } from "vitest";
import { localVaultArchiveImportFeedback } from "@/modules/local-vault/presentation/local-vault-archive-import-feedback";

describe("Local Vault archive import feedback", () => {
  it("reports an archive with no new accounts as an informational warning", () => {
    expect(localVaultArchiveImportFeedback(0)).toEqual({ tone: "warning", message: "noNewAccounts" });
  });

  it("reports imported accounts as success and preserves the imported count", () => {
    expect(localVaultArchiveImportFeedback(3)).toEqual({ tone: "success", message: "imported", count: 3 });
  });
});
