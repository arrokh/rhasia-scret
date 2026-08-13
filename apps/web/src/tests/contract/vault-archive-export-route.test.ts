import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "owner-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/rate-limiting", () => ({ rateLimitApplicationUser: vi.fn(async () => null) }));

import { createVaultArchiveExportAuditHandler } from "@/app/api/vaults/[vaultId]/archive-exports/route";

describe("Vault archive export audit route", () => {
  it("records a redacted owner-authorized event for a bodyless request", async () => {
    const audit = { recordArchiveExport: vi.fn(async () => true), recordAccountAccess: vi.fn(), listForOwner: vi.fn() };
    const POST = createVaultArchiveExportAuditHandler({ sessionVerifier: {} as never, applicationUsers: {} as never, audit });
    const request = new Request("http://localhost/api/vaults/vault-1/archive-exports", { method: "POST" });
    const response = await POST(request as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(204);
    expect(audit.recordArchiveExport).toHaveBeenCalledWith("owner-1", "vault-1");
  });

  it("accepts a semantically bodyless request represented by an empty stream", async () => {
    const audit = { recordArchiveExport: vi.fn(async () => true), recordAccountAccess: vi.fn(), listForOwner: vi.fn() };
    const POST = createVaultArchiveExportAuditHandler({ sessionVerifier: {} as never, applicationUsers: {} as never, audit });
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: new ReadableStream({ start(controller) { controller.close(); } }),
      duplex: "half"
    } as RequestInit & { duplex: "half" });
    const response = await POST(request as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(204);
    expect(audit.recordArchiveExport).toHaveBeenCalledWith("owner-1", "vault-1");
  });

  it("rejects request content without auditing it", async () => {
    const audit = { recordArchiveExport: vi.fn(async () => true), recordAccountAccess: vi.fn(), listForOwner: vi.fn() };
    const POST = createVaultArchiveExportAuditHandler({ sessionVerifier: {} as never, applicationUsers: {} as never, audit });
    const response = await POST(new Request("http://localhost/api", { method: "POST", body: "sensitive-content-must-not-be-read" }) as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(400);
    expect(audit.recordArchiveExport).not.toHaveBeenCalled();
  });

  it("does not release success when ownership authorization fails", async () => {
    const audit = { recordArchiveExport: vi.fn(async () => false), recordAccountAccess: vi.fn(), listForOwner: vi.fn() };
    const POST = createVaultArchiveExportAuditHandler({ sessionVerifier: {} as never, applicationUsers: {} as never, audit });
    const response = await POST(new Request("http://localhost/api", { method: "POST" }) as never, { params: Promise.resolve({ vaultId: "viewer-vault" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "owner_access_required" });
  });
});
