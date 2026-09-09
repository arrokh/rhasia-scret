import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ removeCredential: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({
  loadApplicationUser: async () => ({ id: "user-1", canAccessApplication: () => true }),
}));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class {},
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/identity/infrastructure/prisma-passkey-recovery-repository", () => ({
  PrismaPasskeyRecoveryRepository: class {
    removeCredential = mocks.removeCredential;
  },
}));

import { DELETE } from "@/app/api/passkey-recovery/route";

describe("DELETE /api/passkey-recovery", () => {
  afterEach(() => vi.clearAllMocks());

  it("removes the authenticated user's credential and encrypted recovery package", async () => {
    mocks.removeCredential.mockResolvedValue(undefined);

    const response = await DELETE();

    expect(response.status).toBe(204);
    expect(mocks.removeCredential).toHaveBeenCalledWith("user-1");
  });
});
