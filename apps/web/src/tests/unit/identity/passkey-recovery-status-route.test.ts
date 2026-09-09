import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCredential: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({
  loadApplicationUser: async () => ({ id: "user-1", canAccessApplication: () => true }),
}));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class {},
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/identity/infrastructure/prisma-passkey-recovery-repository", () => ({
  PrismaPasskeyRecoveryRepository: class {
    getCredential = mocks.getCredential;
  },
}));

import { GET } from "@/app/api/passkey-recovery/status/route";

describe("GET /api/passkey-recovery/status", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    [true, { id: "credential" }],
    [false, null],
  ])("reports enrolled=%s from persisted credential state", async (enrolled, credential) => {
    mocks.getCredential.mockResolvedValue(credential);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enrolled });
  });
});
