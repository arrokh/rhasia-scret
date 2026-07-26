import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listForOwner: vi.fn(), recordAccountAccess: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "user-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-management/infrastructure/prisma-vault-audit-repository", () => ({ PrismaVaultAuditRepository: class { listForOwner = mocks.listForOwner; recordAccountAccess = mocks.recordAccountAccess; } }));

import { GET, POST } from "@/app/api/shared-vaults/[vaultId]/audit-events/route";

describe("Shared Vault audit route", () => {
  afterEach(() => vi.clearAllMocks());

  it("records an authorized opaque account-access event and rejects malformed JSON", async () => {
    mocks.recordAccountAccess.mockResolvedValue(true);
    const response = await POST(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: "ACCOUNT_ACCESSED", accountId: "account-1" }) }) as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(204);
    expect(mocks.recordAccountAccess).toHaveBeenCalledWith("user-1", "vault-1", "account-1");

    const malformed = await POST(new Request("http://localhost/api", { method: "POST", body: "{" }) as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(malformed.status).toBe(400);
  });

  it("applies exact account and actor filters before returning redacted owner-only events", async () => {
    mocks.listForOwner.mockResolvedValue([{ id: "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "viewer-1", actorEmail: "viewer@example.test", createdAt: new Date("2026-07-26T12:00:00.000Z") }]);
    const response = await GET(new NextRequest("http://localhost/api?accountId=account-1&actorUserId=viewer-1"), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(mocks.listForOwner).toHaveBeenCalledWith("user-1", "vault-1", { accountId: "account-1", actorUserId: "viewer-1" });
    await expect(response.json()).resolves.toEqual({ events: [{ id: "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "viewer-1", actorEmail: "viewer@example.test", createdAt: "2026-07-26T12:00:00.000Z" }] });
  });
});
