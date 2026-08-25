/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVaultAuditEvents } from "@/modules/audit/infrastructure/browser-vault-audit-client";

describe("loadVaultAuditEvents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests exact opaque filters and defensively excludes non-matching events", async () => {
    const events = [
      { id: "matching", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "user-1", actorEmail: "one@example.test", createdAt: "2026-07-26T12:00:00.000Z" },
      { id: "wrong-account", eventType: "ACCOUNT_ACCESSED", targetId: "account-2", actorUserId: "user-1", actorEmail: "one@example.test", createdAt: "2026-07-26T12:00:00.000Z" },
      { id: "wrong-user", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "user-2", actorEmail: "two@example.test", createdAt: "2026-07-26T12:00:00.000Z" }
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events, nextCursor: "next-page" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadVaultAuditEvents("vault/1", { accountId: "account/1", actorUserId: "user/1" })).resolves.toEqual({ events: [], nextCursor: "next-page" });
    expect(fetchMock).toHaveBeenCalledWith("/api/vaults/vault%2F1/audit-events?accountId=account%2F1&actorUserId=user%2F1", { cache: "no-store", method: "GET" });

    await expect(loadVaultAuditEvents("vault-1", { accountId: "account-1", actorUserId: "user-1" }, "opaque cursor")).resolves.toEqual({ events: [events[0]], nextCursor: "next-page" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/vaults/vault-1/audit-events?accountId=account-1&actorUserId=user-1&cursor=opaque+cursor", { cache: "no-store", method: "GET" });
  });

  it("maps unknown persisted event strings to the redacted security fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      events: [{ id: "future", eventType: "FUTURE_EVENT", targetId: null, actorUserId: "user-1", actorEmail: "one@example.test", createdAt: "2026-07-26T12:00:00.000Z" }],
      nextCursor: null
    }) }));

    const page = await loadVaultAuditEvents("vault-1");

    expect(page.events[0]?.eventType).toBe("UNKNOWN_SECURITY_ACTIVITY");
  });
});
