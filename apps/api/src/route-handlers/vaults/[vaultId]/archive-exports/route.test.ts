import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createVaultArchiveExportAuditHandler } from "@api/route-handlers/vaults/[vaultId]/archive-exports/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const user = new ApplicationUser("owner-1", "rhasia:passwordless", "subject-1", "owner@example.test", "ACTIVE");
const context = { params: Promise.resolve({ vaultId: "vault-1" }) };
const request = (init?: RequestInit) =>
  new ApiRequest("https://api.example.test/v1/vaults/vault-1/archive-exports", init);

describe("POST /v1/vaults/:vaultId/archive-exports contract", () => {
  const createAudit = (recordArchiveExport = vi.fn(async () => true)) => ({
    recordArchiveExport,
    recordAccountAccess: vi.fn(),
    listForOwner: vi.fn(),
  });

  it("records a redacted owner-authorized event for a bodyless request", async () => {
    const audit = createAudit();
    const post = createVaultArchiveExportAuditHandler({ authenticate: async () => user, audit });
    const response = await post(request({ method: "POST" }), context);
    expect(response.status).toBe(204);
    expect(audit.recordArchiveExport).toHaveBeenCalledWith("owner-1", "vault-1");
  });

  it("accepts a semantically bodyless request represented by an empty stream", async () => {
    const audit = createAudit();
    const post = createVaultArchiveExportAuditHandler({ authenticate: async () => user, audit });
    const response = await post(
      request({
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      context,
    );
    expect(response.status).toBe(204);
    expect(audit.recordArchiveExport).toHaveBeenCalledWith("owner-1", "vault-1");
  });

  it("rejects request content without auditing it", async () => {
    const audit = createAudit();
    const post = createVaultArchiveExportAuditHandler({ authenticate: async () => user, audit });
    const response = await post(request({ method: "POST", body: "sensitive-content-must-not-be-read" }), context);
    expect(response.status).toBe(400);
    expect(audit.recordArchiveExport).not.toHaveBeenCalled();
  });

  it("does not release success when ownership authorization fails", async () => {
    const audit = createAudit(vi.fn(async () => false));
    const post = createVaultArchiveExportAuditHandler({ authenticate: async () => user, audit });
    const response = await post(request({ method: "POST" }), { params: Promise.resolve({ vaultId: "viewer-vault" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "owner_access_required" });
  });
});
