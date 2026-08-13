import type { AuthenticatedTransport, PlatformHttpRequest, PlatformHttpResponse } from "@rhasia-scret/client-vault-core";
import { loadMobileVaultAuditEvents } from "./mobile-vault-audit";

describe("mobile Shared Vault audit history", () => {
  it("loads locale-independent authorized audit values without caching", async () => {
    const event = { id: "event_1", eventType: "ACCOUNT_ACCESSED", targetId: "account_1", actorUserId: "user_1", actorEmail: "actor@example.test", createdAt: "2026-08-11T22:00:00.000Z" };
    const transport = new StubTransport({ events: [event], nextCursor: null });
    await expect(loadMobileVaultAuditEvents("shared_1", transport)).resolves.toEqual([event]);
    expect(transport.requestValue).toEqual({ url: "/api/shared-vaults/shared_1/audit-events", method: "GET", cache: "no-store" });
  });

  it("fails closed on malformed history", async () => {
    await expect(loadMobileVaultAuditEvents("shared_1", new StubTransport({ events: [{ actorEmail: "missing-contract" }] }))).rejects.toThrow("response is invalid");
  });
});

class StubTransport implements AuthenticatedTransport {
  public requestValue?: PlatformHttpRequest;
  public constructor(private readonly body: unknown) {}
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requestValue = request;
    return { status: 200, ok: true, headers: { get: () => null }, json: async <Value,>() => this.body as Value, bytes: async () => new Uint8Array(), text: async () => JSON.stringify(this.body) };
  }
}
