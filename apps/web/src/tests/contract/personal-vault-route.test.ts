import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { createGetPersonalVaultHandler } from "@/app/api/personal-vault/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { Vault } from "@/modules/vault-management";

describe("GET /api/personal-vault contract", () => {
  it("rejects unauthenticated callers", async () => {
    const handler = createGetPersonalVaultHandler({
      authenticate: async () => NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
      personalVaults: { ensureForOwner: async () => { throw new Error("must not create"); } }
    });
    const response = await handler();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("returns generic lifecycle metadata without a vault name", async () => {
    const handler = createGetPersonalVaultHandler({
      authenticate: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE"),
      personalVaults: { ensureForOwner: async () => new Vault("vault-1", "PERSONAL", "user-1", "UNINITIALIZED") }
    });
    const response = await handler();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "vault-1", lifecycle: "UNINITIALIZED" });
  });
});
