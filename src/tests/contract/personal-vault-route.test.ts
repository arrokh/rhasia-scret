import { describe, expect, it } from "vitest";
import { createGetPersonalVaultHandler } from "@/app/api/personal-vault/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";
import { Vault } from "@/modules/vault-management";

describe("GET /api/personal-vault contract", () => {
  it("rejects unauthenticated callers", async () => {
    const handler = createGetPersonalVaultHandler({
      sessionVerifier: new FakeSessionVerifier(null),
      applicationUsers: { provision: async () => { throw new Error("must not provision"); } },
      personalVaults: { ensureForOwner: async () => { throw new Error("must not create"); } }
    });
    const response = await handler();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("returns generic lifecycle metadata without a vault name", async () => {
    const handler = createGetPersonalVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      personalVaults: { ensureForOwner: async () => new Vault("vault-1", "PERSONAL", "user-1", "UNINITIALIZED") }
    });
    const response = await handler();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "vault-1", lifecycle: "UNINITIALIZED" });
  });
});
