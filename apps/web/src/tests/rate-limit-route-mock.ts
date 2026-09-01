import { vi } from "vitest";

vi.mock("@/modules/rate-limiting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/rate-limiting")>();
  return { ...actual, rateLimitApplicationUser: vi.fn(async () => null) };
});

vi.mock("@/modules/server-composition/server", () => ({
  executeAuthenticatedApplicationRequest: vi.fn(async (request: { access: "reader" | "mutation"; operation?: string }) => {
    const identity = await import("@/modules/identity/server");
    const user = await identity.loadApplicationUser(identity.createSessionVerifier(), identity.createApplicationUserRepository());
    if (!user) return { status: "unauthenticated" as const };
    if (!user.canAccessApplication()) return { status: "inactive_user" as const };
    if (request.access === "mutation" && request.operation) {
      const rateLimiting = await import("@/modules/rate-limiting");
      const response = await rateLimiting.rateLimitApplicationUser(request.operation as never, user.id);
      if (response) {
        return {
          status: response.status === 429 ? "rate_limited" as const : "rate_limit_unavailable" as const,
          retryAfterSeconds: Number(response.headers.get("retry-after") ?? "1")
        };
      }
    }
    return { status: "allowed" as const, user };
  })
}));
