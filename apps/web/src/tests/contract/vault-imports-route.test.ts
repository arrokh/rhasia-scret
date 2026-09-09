import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createEncryptedVaultImportHandler } from "@/app/api/vault-imports/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import type { EncryptedVaultImportRepository } from "@/modules/vault-archive";

const accountId = "c4e75cb6-5cc5-4df6-8607-afb56569456e";
const vaultId = "ae5c3ad6-d399-48d9-bb00-68722deed795";
const ciphertext = encryptedBlob();

describe("POST /api/vault-imports contract", () => {
  it("passes only bounded ciphertext and opaque metadata to one atomic repository call", async () => {
    const importArchive = vi
      .fn<EncryptedVaultImportRepository["import"]>()
      .mockResolvedValue({ status: "IMPORTED", vaultId, accountIds: [accountId], vaultCreated: true });
    const handler = createHandler(importArchive);
    const body = {
      destination: {
        kind: "NEW_SHARED",
        vaultId,
        encryptedName: ciphertext,
        encryptedOwnerVaultKey: ciphertext,
        encryptionVersion: 1,
      },
      accounts: [{ id: accountId, encryptedPayload: ciphertext, encryptionVersion: 1 }],
    };

    const response = await handler(request(body));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      vaultId,
      accountIds: [accountId],
      vaultCreated: true,
      replayed: false,
    });
    expect(importArchive).toHaveBeenCalledOnce();
    const persisted = importArchive.mock.calls[0][1];
    expect(persisted.destination.kind).toBe("NEW_SHARED");
    if (persisted.destination.kind !== "NEW_SHARED") throw new Error("Expected a new Shared Vault destination.");
    expect(persisted.destination.encryptedName).toBeInstanceOf(Uint8Array);
    expect(persisted.accounts[0].encryptedPayload).toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(persisted)).not.toContain("Imported Vault");
    expect(JSON.stringify(persisted)).not.toContain("issuer");
    expect(JSON.stringify(persisted)).not.toContain("secret");
  });

  it("rejects incomplete or conflicting imports without accepting partial writes", async () => {
    const importArchive = vi.fn<EncryptedVaultImportRepository["import"]>();
    const handler = createHandler(importArchive);
    const incomplete = await handler(
      request({
        destination: { kind: "EXISTING", vaultId: "vault-1", vaultType: "PERSONAL" },
        accounts: [{ id: accountId, encryptionVersion: 1 }],
      }),
    );
    expect(incomplete.status).toBe(400);
    expect(importArchive).not.toHaveBeenCalled();

    importArchive.mockResolvedValueOnce({ status: "CONFLICT" });
    const conflict = await handler(
      request({
        destination: { kind: "EXISTING", vaultId: "vault-1", vaultType: "PERSONAL" },
        accounts: [{ id: accountId, encryptedPayload: ciphertext, encryptionVersion: 1 }],
      }),
    );
    expect(conflict.status).toBe(409);
  });

  it("rejects oversized requests before invoking persistence", async () => {
    const importArchive = vi.fn<EncryptedVaultImportRepository["import"]>();
    const handler = createHandler(importArchive);
    const response = await handler(
      new NextRequest("http://localhost/api/vault-imports", {
        method: "POST",
        body: "{}",
        headers: { "content-length": String(8 * 1024 * 1024 + 1) },
      }),
    );
    expect(response.status).toBe(413);
    expect(importArchive).not.toHaveBeenCalled();
  });

  it("rejects unsupported ciphertext envelope versions", async () => {
    const importArchive = vi.fn<EncryptedVaultImportRepository["import"]>();
    const handler = createHandler(importArchive);
    const unsupported = Buffer.from(Uint8Array.from({ length: 29 }, (_, index) => (index === 0 ? 3 : 7))).toString(
      "base64",
    );
    const response = await handler(
      request({
        destination: { kind: "EXISTING", vaultId: "vault-1", vaultType: "PERSONAL" },
        accounts: [{ id: accountId, encryptedPayload: unsupported, encryptionVersion: 1 }],
      }),
    );
    expect(response.status).toBe(400);
    expect(importArchive).not.toHaveBeenCalled();
  });
});

function createHandler(importArchive: EncryptedVaultImportRepository["import"]) {
  return createEncryptedVaultImportHandler({
    authenticate: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "owner@example.test", "ACTIVE"),
    imports: { import: importArchive },
  });
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/vault-imports", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function encryptedBlob(): string {
  return Buffer.from(Uint8Array.from({ length: 29 }, (_, index) => (index === 0 ? 1 : 7))).toString("base64");
}
