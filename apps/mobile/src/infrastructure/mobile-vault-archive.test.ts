import type { UnlockedVaultWorkspace } from "@rhasia-scret/client-vault-core";
import { createVaultArchiveProtocol } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport, PlatformHttpRequest, PlatformHttpResponse } from "@rhasia-scret/client-vault-core";
import { importOpenedArchiveIntoVault, prepareMobileVaultArchive } from "./mobile-vault-archive";
import { nativeClientCrypto } from "./native-client-crypto";

jest.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: async () => undefined }));

describe("mobile Vault archives", () => {
  it("creates the exact portable encrypted archive format and keeps the archive key separate", async () => {
    const workspace = fixtureWorkspace();
    const auditTransport = new AuditTransport();
    const prepared = await prepareMobileVaultArchive(workspace, workspace.vaults[0], auditTransport);
    expect(auditTransport.requests[0]).toEqual({ url: "/api/vaults/vault_1/archive-exports", method: "POST", cache: "no-store" });
    const opened = await createVaultArchiveProtocol(nativeClientCrypto).openEncryptedVaultExport(prepared.key, prepared.archive);

    expect(prepared.filename).toMatch(/^rhasia-vault-\d{4}-\d{2}-\d{2}\.rhasia-vault$/);
    expect(prepared.archive[0]).toBe(2);
    expect(opened.vaultName).toBe("Personal");
    expect(opened.accounts).toHaveLength(1);
    for (const payload of opened.accounts) payload.fill(0);
    prepared.archive.fill(0);
    prepared.key.fill(0);
    workspace.accounts[0].secret.fill(0);
  });

  it("never releases prepared archive material when mandatory audit recording fails", async () => {
    const workspace = fixtureWorkspace();
    const transport: AuthenticatedTransport = { request: async () => ({ status: 503, ok: false, headers: { get: () => null }, json: async <Value,>() => null as Value, bytes: async () => new Uint8Array(), text: async () => "" }) };
    await expect(prepareMobileVaultArchive(workspace, workspace.vaults[0], transport)).rejects.toThrow("audit");
    workspace.accounts[0].secret.fill(0);
  });

  it("uploads only re-encrypted account payloads through the existing archive endpoint", async () => {
    const workspace = fixtureWorkspace();
    const transport = new ImportTransport();
    await importOpenedArchiveIntoVault({
      vaultName: "Imported",
      accounts: [workspace.accounts[0]],
    }, workspace.vaults[0], transport);

    const requestText = String(transport.requests[0].body);
    expect(requestText).not.toContain("RFC");
    expect(requestText).not.toContain("vector");
    expect(requestText).not.toContain("12345678901234567890");
    expect(transport.requests[0].url).toBe("/api/vault-imports");
    workspace.accounts[0].secret.fill(0);
  });
});

class AuditTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    return { status: 204, ok: true, headers: { get: () => null }, json: async <Value,>() => null as Value, bytes: async () => new Uint8Array(), text: async () => "" };
  }
}

class ImportTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    const body = JSON.parse(String(request.body)) as { destination: { vaultId: string }; accounts: Array<{ id: string }> };
    const result = { vaultId: body.destination.vaultId, accountIds: body.accounts.map(({ id }) => id), vaultCreated: false, replayed: false };
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async <Value,>() => result as Value,
      bytes: async () => new Uint8Array(),
      text: async () => JSON.stringify(result),
    };
  }
}

function fixtureWorkspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile_1",
    synchronizedAt: "2026-08-11T22:00:00.000Z",
    synchronizationToken: "token",
    syncState: "CURRENT",
    userRootKey: new Uint8Array(32).fill(1),
    vaults: [{
      id: "vault_1",
      name: "Personal",
      type: "PERSONAL",
      role: "OWNER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
      },
      key: new Uint8Array(32).fill(2),
    }],
    accounts: [{
      id: "account_1",
      vaultId: "vault_1",
      vaultName: "Personal",
      vaultType: "PERSONAL",
      revision: 1,
      issuer: "RFC",
      accountName: "vector",
      secret: new TextEncoder().encode("12345678901234567890"),
      algorithm: "SHA-1",
      digits: 8,
      period: 30,
    }],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}
