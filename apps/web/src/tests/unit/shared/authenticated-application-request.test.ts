import { describe, expect, it, vi } from "vitest";
import { ApplicationUser, type SessionAssurance, type VerifiedPrincipal } from "@/modules/identity";
import {
  createAuthenticatedApplicationExecutor,
  type AuthenticatedApplicationDependencies,
} from "@/modules/server-composition";

const principal: VerifiedPrincipal = {
  issuer: "https://identity.example.test",
  subject: "principal_1",
  email: "user@example.test",
  emailVerified: true,
  assurance: "fresh-provider-user",
};

function dependencies(overrides: Partial<AuthenticatedApplicationDependencies> = {}) {
  const value: AuthenticatedApplicationDependencies = {
    verifySession: vi.fn(async () => principal),
    provisionApplicationUser: vi.fn(
      async () => new ApplicationUser("user_1", principal.issuer, principal.subject, principal.email, "ACTIVE"),
    ),
    checkApplicationRateLimit: vi.fn(async () => ({ status: "allowed" as const })),
    ...overrides,
  };
  return value;
}

describe("authenticated application request", () => {
  it("requires callers to select and forwards the explicit assurance level", async () => {
    const deps = dependencies();
    await createAuthenticatedApplicationExecutor(deps)({ assurance: "active-session", access: "reader" });
    expect(deps.verifySession).toHaveBeenCalledWith("active-session" satisfies SessionAssurance);
  });

  it("distinguishes a missing session from a missing Application User", async () => {
    const noSession = createAuthenticatedApplicationExecutor(dependencies({ verifySession: vi.fn(async () => null) }));
    const noUser = createAuthenticatedApplicationExecutor(
      dependencies({ provisionApplicationUser: vi.fn(async () => null) }),
    );
    await expect(noSession({ assurance: "fresh-provider-user", access: "reader" })).resolves.toEqual({
      status: "unauthenticated",
    });
    await expect(noUser({ assurance: "fresh-provider-user", access: "reader" })).resolves.toEqual({
      status: "application_user_unavailable",
    });
  });

  it("rejects inactive users before consuming a mutation budget", async () => {
    const deps = dependencies({
      provisionApplicationUser: vi.fn(
        async () => new ApplicationUser("user_1", principal.issuer, principal.subject, principal.email, "INACTIVE"),
      ),
    });
    const execute = createAuthenticatedApplicationExecutor(deps);
    await expect(
      execute({ assurance: "fresh-provider-user", access: "mutation", operation: "account_mutation" }),
    ).resolves.toEqual({ status: "inactive_user" });
    expect(deps.checkApplicationRateLimit).not.toHaveBeenCalled();
  });

  it("keeps readers outside mutation budgets", async () => {
    const deps = dependencies();
    const result = await createAuthenticatedApplicationExecutor(deps)({
      assurance: "verified-claims",
      access: "reader",
    });
    expect(result.status).toBe("allowed");
    expect(deps.checkApplicationRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "limited", retryAfterSeconds: 17 } as const, { status: "rate_limited", retryAfterSeconds: 17 }],
    [
      { status: "unavailable", retryAfterSeconds: 5 } as const,
      { status: "rate_limit_unavailable", retryAfterSeconds: 5 },
    ],
  ])("preserves denied mutation decisions", async (decision, expected) => {
    const deps = dependencies({ checkApplicationRateLimit: vi.fn(async () => decision) });
    const execute = createAuthenticatedApplicationExecutor(deps);
    await expect(
      execute({ assurance: "fresh-provider-user", access: "mutation", operation: "membership_mutation" }),
    ).resolves.toEqual(expected);
    expect(deps.checkApplicationRateLimit).toHaveBeenCalledWith("membership_mutation", "user_1");
  });
});
