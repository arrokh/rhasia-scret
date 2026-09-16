import { describe, expect, it } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createGetPersonalVaultHandler } from "@api/route-handlers/personal-vault/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { Vault } from "@api/modules/vault-management/domain/vault";

const request = new ApiRequest("https://api.example.test/v1/personal-vault");

describe("GET /v1/personal-vault contract", () => {
  it("rejects unauthenticated callers", async () => {
    const handler = createGetPersonalVaultHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      personalVaults: {
        ensureForOwner: async () => {
          throw new Error("must not create");
        },
      },
    });
    const response = await handler(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("returns generic lifecycle metadata without a vault name", async () => {
    const handler = createGetPersonalVaultHandler({
      authenticate: async () =>
        new ApplicationUser("user-1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE"),
      personalVaults: { ensureForOwner: async () => new Vault("vault-1", "PERSONAL", "user-1", "UNINITIALIZED") },
    });
    const response = await handler(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "vault-1", lifecycle: "UNINITIALIZED" });
  });
});
