import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ postEmpty: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({ browserApiClient: { postEmpty: mocks.postEmpty } }));

import { recordPersonalVaultAccountCopiesToLocal } from "@/modules/audit/infrastructure/browser-vault-audit-client";

describe("Personal Vault copy audit client", () => {
  it("sends only the copy direction and opaque Personal Vault account identifiers", async () => {
    mocks.postEmpty.mockResolvedValue(undefined);

    await recordPersonalVaultAccountCopiesToLocal("vault/1", ["account-1", "account-2"]);

    expect(mocks.postEmpty).toHaveBeenCalledWith("/api/vaults/vault%2F1/audit-events", {
      eventType: "ACCOUNT_COPIED_TO_LOCAL",
      accountIds: ["account-1", "account-2"]
    });
  });
});
