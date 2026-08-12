import type { AuthenticatedTransport, PlatformHttpRequest, PlatformHttpResponse } from "@rhasia-scret/client-vault-core";
import { loadMobileVaultPermissionDefaults, updateMobileVaultPermissionDefaults } from "./mobile-vault-permissions";

describe("mobile Shared Vault permission defaults", () => {
  it("preserves optimistic revisions through authorized transport", async () => {
    const transport = new StubTransport();
    const loaded = await loadMobileVaultPermissionDefaults("shared_1", transport);
    const updated = await updateMobileVaultPermissionDefaults("shared_1", { ...loaded, permissions: { ...loaded.permissions, canDeleteAccounts: true } }, transport);
    expect(updated.revision).toBe(3);
    expect(transport.requests[1]).toEqual({
      url: "/api/shared-vaults/shared_1/member-permissions",
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2, canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: true }),
      cache: "no-store",
    });
  });
});

class StubTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const patch = request.method === "PATCH";
    const body = { vaultDefaultAccountPermissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: patch }, vaultDefaultAccountPermissionsRevision: patch ? 3 : 2 };
    return { status: 200, ok: true, headers: { get: () => null }, json: async <Value,>() => body as Value, bytes: async () => new Uint8Array(), text: async () => JSON.stringify(body) };
  }
}
