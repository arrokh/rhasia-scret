import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createDestructivePersonalVaultResetHandler } from "@/app/api/personal-vault/destructive-reset/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  DESTRUCTIVE_RESET_CONFIRMATION,
  PasskeyRecoveryAlreadyEnrolledError
} from "@/modules/vault-management/application/destructive-personal-vault-reset";

function handler(reset: () => Promise<void>) {
  return createDestructivePersonalVaultResetHandler({
    sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
    applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
    resets: { getEligibility: vi.fn(), reset }
  });
}

function request(confirmation: string) {
  return new NextRequest("http://localhost/api/personal-vault/destructive-reset", {
    method: "POST",
    body: JSON.stringify({ confirmation })
  });
}

describe("POST /api/personal-vault/destructive-reset contract", () => {
  it("performs a confirmed destructive reset", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);

    const response = await handler(reset)(request(DESTRUCTIVE_RESET_CONFIRMATION));

    expect(response.status).toBe(204);
    expect(reset).toHaveBeenCalledWith("user-1");
  });

  it("rejects an incorrect confirmation", async () => {
    const reset = vi.fn();

    const response = await handler(reset)(request("wrong confirmation"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_confirmation" });
    expect(reset).not.toHaveBeenCalled();
  });

  it("requires passkey recovery when it is enrolled", async () => {
    const response = await handler(vi.fn().mockRejectedValue(new PasskeyRecoveryAlreadyEnrolledError()))(
      request(DESTRUCTIVE_RESET_CONFIRMATION)
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "passkey_recovery_available" });
  });

  it("blocks users who still own an active Shared Vault", async () => {
    const response = await handler(vi.fn().mockRejectedValue(new ActiveOwnedSharedVaultsPreventResetError(2)))(
      request(DESTRUCTIVE_RESET_CONFIRMATION)
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "owned_shared_vaults_exist", count: 2 });
  });
});
