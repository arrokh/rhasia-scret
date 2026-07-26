import { describe, expect, it, vi } from "vitest";
import { runRetentionPurge } from "@/modules/retention";

describe("runRetentionPurge", () => {
  it("drains bounded batches in policy order and reports only opaque identifiers", async () => {
    const order: string[] = [];
    const accountBatches = [["account_1", "account_2"], ["account_3"]];
    const vaultBatches = [["vault_1"], []];
    const auditBatches = [["event_1", "event_2"], []];
    const accounts = { purgeExpired: vi.fn(async () => { order.push("accounts"); return { purgedIds: accountBatches.shift() ?? [] }; }) };
    const vaults = {
      purgeExpiredVaults: vi.fn(async () => { order.push("vaults"); return { purgedIds: vaultBatches.shift() ?? [] }; }),
      purgeExpiredAuditEvents: vi.fn(async () => { order.push("audit"); return { purgedIds: auditBatches.shift() ?? [] }; })
    };

    const report = await runRetentionPurge({ accounts, vaults, now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 2, maxBatches: 3 });

    expect(report).toEqual({
      accountIds: ["account_1", "account_2", "account_3"],
      vaultIds: ["vault_1"],
      auditEventIds: ["event_1", "event_2"],
      accountBacklogRemaining: false,
      vaultBacklogRemaining: false,
      auditBacklogRemaining: false
    });
    expect(order).toEqual(["accounts", "accounts", "vaults", "audit", "audit"]);
    expect(accounts.purgeExpired).toHaveBeenCalledWith(new Date("2026-01-01T00:00:00.000Z"), 2);
  });

  it("stops at the configured maximum and flags possible backlog without unbounded work", async () => {
    const accounts = { purgeExpired: vi.fn(async () => ({ purgedIds: ["account_1"] })) };
    const vaults = {
      purgeExpiredVaults: vi.fn(async () => ({ purgedIds: ["vault_1"] })),
      purgeExpiredAuditEvents: vi.fn(async () => ({ purgedIds: ["event_1"] }))
    };

    const report = await runRetentionPurge({ accounts, vaults, now: new Date(), batchSize: 1, maxBatches: 2 });

    expect(accounts.purgeExpired).toHaveBeenCalledTimes(2);
    expect(vaults.purgeExpiredVaults).toHaveBeenCalledTimes(2);
    expect(vaults.purgeExpiredAuditEvents).toHaveBeenCalledTimes(2);
    expect(report).toEqual(expect.objectContaining({ accountBacklogRemaining: true, vaultBacklogRemaining: true, auditBacklogRemaining: true }));
  });

  it("is idempotent when repositories report no eligible records", async () => {
    const accounts = { purgeExpired: vi.fn(async () => ({ purgedIds: [] })) };
    const vaults = { purgeExpiredVaults: vi.fn(async () => ({ purgedIds: [] })), purgeExpiredAuditEvents: vi.fn(async () => ({ purgedIds: [] })) };

    const first = await runRetentionPurge({ accounts, vaults, now: new Date() });
    const second = await runRetentionPurge({ accounts, vaults, now: new Date() });

    expect(first.accountIds).toEqual([]);
    expect(second).toEqual(first);
  });
});
