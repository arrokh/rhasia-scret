import { describe, expect, it, vi } from "vitest";
import { createRetentionPurgeHandler } from "@/app/api/internal/retention-purge/route";

const secret = "0123456789abcdef0123456789abcdef";
const report = {
  accountIds: ["account_1"],
  vaultIds: ["vault_1"],
  auditEventIds: ["event_1"],
  accountBacklogRemaining: false,
  vaultBacklogRemaining: false,
  auditBacklogRemaining: false
};

describe("GET /api/internal/retention-purge contract", () => {
  it("requires a configured constant-time Bearer secret before running cleanup", async () => {
    const purge = vi.fn();
    const handler = createRetentionPurgeHandler({ secret, purge, logger: { info: vi.fn(), error: vi.fn() }, createJobId: () => "job_1" });

    expect((await handler(new Request("http://localhost/api/internal/retention-purge"))).status).toBe(401);
    expect((await handler(new Request("http://localhost/api/internal/retention-purge", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(purge).not.toHaveBeenCalled();

    const unconfigured = createRetentionPurgeHandler({ secret: "short", purge, logger: { info: vi.fn(), error: vi.fn() }, createJobId: () => "job_1" });
    expect((await unconfigured(new Request("http://localhost/api/internal/retention-purge", { headers: { authorization: `Bearer ${secret}` } }))).status).toBe(503);
  });

  it("returns counts and logs only opaque IDs, counts, backlog state, and job metadata", async () => {
    const info = vi.fn();
    const handler = createRetentionPurgeHandler({ secret, purge: async () => report, logger: { info, error: vi.fn() }, createJobId: () => "job_1" });
    const response = await handler(new Request("http://localhost/api/internal/retention-purge", { headers: { authorization: `Bearer ${secret}` } }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ jobId: "job_1", accountCount: 1, vaultCount: 1, auditEventCount: 1, accountBacklogRemaining: false, vaultBacklogRemaining: false, auditBacklogRemaining: false });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "retention_purge_completed", accountIds: ["account_1"], vaultIds: ["vault_1"], auditEventIds: ["event_1"] }));
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/encryptedPayload|encryptedName|ciphertext|totp|secret/i);
  });

  it("redacts cleanup errors and remains retry-safe", async () => {
    const error = vi.fn();
    const handler = createRetentionPurgeHandler({ secret, purge: async () => { throw new Error("ciphertext-value-that-must-not-be-logged"); }, logger: { info: vi.fn(), error }, createJobId: () => "job_2" });
    const response = await handler(new Request("http://localhost/api/internal/retention-purge", { headers: { authorization: `Bearer ${secret}` } }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "retention_purge_failed", jobId: "job_2" });
    expect(error).toHaveBeenCalledWith({ event: "retention_purge_failed", jobId: "job_2" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("ciphertext-value");
  });
});
