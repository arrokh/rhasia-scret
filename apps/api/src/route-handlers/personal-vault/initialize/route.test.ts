import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { createInitializePersonalVaultHandler } from "./route";

const payload = {
  vaultUnlockSalt: "MDEyMzQ1Njc4OWFiY2RlZg==",
  wrappedUserRootKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  encryptedPersonalVaultKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  encryptedVaultName: "ZW5jcnlwdGVkLXBlcnNvbmFsLXZhdWx0LW5hbWU=",
  encryptionVersion: 1 as const,
};

const user = new ApplicationUser("user_1", "rhasia:passwordless", "subject_1", "user@example.test", "ACTIVE");

describe("POST /v1/personal-vault/initialize contract", () => {
  it("passes only validated opaque encrypted material to the API application", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    const response = await createInitializePersonalVaultHandler({
      authenticate: async () => user,
      personalVaults: { initialize },
    })(
      new ApiRequest("https://api.example.test/v1/personal-vault/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(204);
    expect(initialize).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ encryptionVersion: 1, vaultUnlockSalt: expect.any(Uint8Array) }),
    );
    expect(new TextDecoder().decode(initialize.mock.calls[0]?.[1].encryptedVaultName)).toBe(
      "encrypted-personal-vault-name",
    );
  });

  it("rejects malformed payloads before persistence", async () => {
    const initialize = vi.fn();
    const response = await createInitializePersonalVaultHandler({
      authenticate: async () => user,
      personalVaults: { initialize },
    })(
      new ApiRequest("https://api.example.test/v1/personal-vault/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, vaultUnlockSalt: "bad" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_initialization" });
    expect(initialize).not.toHaveBeenCalled();
  });
});
