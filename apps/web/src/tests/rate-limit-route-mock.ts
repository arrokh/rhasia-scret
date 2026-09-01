import { vi } from "vitest";

vi.mock("@/modules/server-composition/server", () => ({
  executeAuthenticatedApplicationRequest: vi.fn(async () => {
    const identity = await import("@/modules/identity/server");
    const user = await identity.loadApplicationUser(identity.createSessionVerifier(), identity.createApplicationUserRepository());
    if (!user) return { status: "unauthenticated" as const };
    if (!user.canAccessApplication()) return { status: "inactive_user" as const };
    return { status: "allowed" as const, user };
  })
}));
