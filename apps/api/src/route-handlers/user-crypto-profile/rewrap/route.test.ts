import { describe, expect, it, vi } from "vitest";
import { ApiRequest } from "@api/http/api-request";
import { createRewrapUserRootKeyHandler } from "@api/route-handlers/user-crypto-profile/rewrap/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const payload = {
  vaultUnlockSalt: btoa("0123456789abcdef"),
  wrappedUserRootKey: btoa("new-wrapped-user-root-key-material"),
  encryptionVersion: 1 as const,
};
const user = new ApplicationUser("user-1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");
const request = (init?: RequestInit) => new ApiRequest("https://api.example.test/v1/user-crypto-profile/rewrap", init);

describe("POST /v1/user-crypto-profile/rewrap contract", () => {
  it("updates only opaque rewrapped User Root Key material for an active user", async () => {
    const rewrapUserRootKey = vi.fn().mockResolvedValue(undefined);
    const handler = createRewrapUserRootKeyHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => undefined,
        rewrapUserRootKey,
      },
    });

    const response = await handler(request({ method: "POST", body: JSON.stringify(payload) }));

    expect(response.status).toBe(204);
    expect(rewrapUserRootKey).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptionVersion: 1 }));
  });

  it("accepts the migrated Personal Vault Encryption Key with the rewrapped root key", async () => {
    const rewrapUserRootKey = vi.fn().mockResolvedValue(undefined);
    const handler = createRewrapUserRootKeyHandler({
      authenticate: async () => user,
      cryptoProfiles: {
        get: async () => null,
        registerUserEncryptionIdentity: async () => undefined,
        rewrapUserRootKey,
      },
    });
    const encryptedPersonalVaultKey = btoa("new-personal-vault-key-material");

    const response = await handler(
      request({ method: "POST", body: JSON.stringify({ ...payload, encryptedPersonalVaultKey }) }),
    );

    expect(response.status).toBe(204);
    expect(rewrapUserRootKey).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ encryptedPersonalVaultKey: expect.any(Uint8Array), encryptionVersion: 1 }),
    );
  });
});
