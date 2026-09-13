import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  readAuthConfiguration: vi.fn(),
  createOidcAuthorizationRequest: vi.fn(),
  completeOidcAuthorization: vi.fn(),
  signOidcSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/modules/identity/infrastructure/auth-backend", () => ({
  readAuthConfiguration: mocks.readAuthConfiguration,
}));
vi.mock("@/modules/identity/infrastructure/oidc-client", () => ({
  createOidcAuthorizationRequest: mocks.createOidcAuthorizationRequest,
  completeOidcAuthorization: mocks.completeOidcAuthorization,
}));
vi.mock("@/modules/identity/infrastructure/oidc-session-verifier", () => ({
  OIDC_NONCE_COOKIE: "rhsia-oidc-nonce",
  OIDC_RETURN_PATH_COOKIE: "rhsia-oidc-return-path",
  OIDC_SESSION_COOKIE: "rhsia-oidc-session",
  OIDC_STATE_COOKIE: "rhsia-oidc-state",
  OIDC_VERIFIER_COOKIE: "rhsia-oidc-pkce",
  signOidcSession: mocks.signOidcSession,
}));

import { GET as beginOidc } from "@/app/auth/oidc/route";
import { GET as completeOidc } from "@/app/auth/oidc/callback/route";

describe("OIDC authentication route contract", () => {
  const configuration = {
    backend: "oidc" as const,
    oidc: {
      issuer: new URL("https://issuer.example.test"),
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: new URL("https://vault.example.test/auth/oidc/callback"),
      sessionSecret: new Uint8Array(32),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAuthConfiguration.mockReturnValue(configuration);
  });

  it("stores only the allowlisted invitation return path before leaving for OIDC", async () => {
    const cookieStore = { get: vi.fn(), set: vi.fn() };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.createOidcAuthorizationRequest.mockResolvedValue({
      url: new URL("https://issuer.example.test/authorize?state=state"),
      state: "state",
      nonce: "nonce",
      verifier: "verifier",
    });

    const response = await beginOidc(
      new Request("https://vault.example.test/auth/oidc?next=%2Fvaults%2Finvitations%2Fredeem"),
    );

    expect(response.headers.get("location")).toBe("https://issuer.example.test/authorize?state=state");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "rhsia-oidc-return-path",
      "/vaults/invitations/redeem",
      expect.any(Object),
    );
  });

  it("returns an authenticated invitation recipient to redemption", async () => {
    const cookieValues = new Map([
      ["rhsia-oidc-state", "state"],
      ["rhsia-oidc-nonce", "nonce"],
      ["rhsia-oidc-pkce", "verifier"],
      ["rhsia-oidc-return-path", "/vaults/invitations/redeem"],
    ]);
    const cookieStore = {
      get: vi.fn((name: string) => {
        const value = cookieValues.get(name);
        return value ? { value } : undefined;
      }),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.completeOidcAuthorization.mockResolvedValue({
      principal: {
        issuer: "https://issuer.example.test",
        subject: "subject",
        email: "person@example.test",
        emailVerified: true,
        assurance: "active-session",
      },
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    mocks.signOidcSession.mockResolvedValue("signed-session");

    const response = await completeOidc(new Request("https://vault.example.test/auth/oidc/callback?code=code"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/auth/complete");
    expect(cookieStore.set).toHaveBeenCalledWith("rhsia-oidc-session", "signed-session", expect.any(Object));
    expect(cookieStore.set).toHaveBeenCalledWith("rhsia-oidc-return-path", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("ignores an unsafe OIDC return path", async () => {
    const cookieStore = { get: vi.fn(), set: vi.fn() };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.createOidcAuthorizationRequest.mockResolvedValue({
      url: new URL("https://issuer.example.test/authorize?state=state"),
      state: "state",
      nonce: "nonce",
      verifier: "verifier",
    });

    const response = await beginOidc(
      new Request("https://vault.example.test/auth/oidc?next=https%3A%2F%2Fattacker.example"),
    );

    expect(response.headers.get("location")).toBe("https://issuer.example.test/authorize?state=state");
    expect(cookieStore.set).toHaveBeenCalledWith("rhsia-oidc-return-path", "/vaults", expect.any(Object));
  });
});
