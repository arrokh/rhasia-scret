import { afterEach, describe, expect, it, vi } from "vitest";
import { OidcSessionVerifier, signOidcSession } from "@/modules/identity/infrastructure/oidc-session-verifier";
import type { OidcConfiguration } from "@/modules/identity/infrastructure/auth-backend";

const configuration: OidcConfiguration = {
  issuer: new URL("https://issuer.example.test"),
  clientId: "client-id",
  clientSecret: "server-secret",
  redirectUri: new URL("https://app.example.test/auth/oidc/callback"),
  sessionSecret: new TextEncoder().encode("12345678901234567890123456789012"),
};

const cookies = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookies) }));

afterEach(() => vi.clearAllMocks());

describe("OIDC server session", () => {
  it("verifies a signed provider-neutral principal and rejects tampering", async () => {
    const token = await signOidcSession(
      configuration,
      {
        issuer: configuration.issuer.href.replace(/\/$/, ""),
        subject: "subject-1",
        email: "person@example.test",
        emailVerified: true,
        assurance: "active-session",
        sessionId: "session-1",
      },
      Math.floor(Date.now() / 1000) + 60,
    );
    cookies.get.mockReturnValue({ value: token });
    await expect(new OidcSessionVerifier(configuration).verify("fresh-provider-user")).resolves.toMatchObject({
      issuer: configuration.issuer.href.replace(/\/$/, ""),
      subject: "subject-1",
      email: "person@example.test",
      emailVerified: true,
      assurance: "active-session",
    });
    cookies.get.mockReturnValue({ value: `${token}tampered` });
    await expect(new OidcSessionVerifier(configuration).verify()).resolves.toBeNull();
  });

  it("preserves provider issuance time for deletion invalidation", async () => {
    const providerIssuedAt = new Date("2026-09-14T23:59:00.000Z");
    const token = await signOidcSession(
      configuration,
      {
        issuer: configuration.issuer.href.replace(/\/$/, ""),
        subject: "subject-1",
        email: "person@example.test",
        emailVerified: true,
        assurance: "active-session",
        issuedAt: providerIssuedAt,
      },
      Math.floor(Date.now() / 1000) + 60,
    );
    cookies.get.mockReturnValue({ value: token });
    await expect(new OidcSessionVerifier(configuration).verify()).resolves.toMatchObject({
      issuedAt: providerIssuedAt,
    });
  });

  it("rejects an expired provider session", async () => {
    const token = await signOidcSession(
      configuration,
      {
        issuer: configuration.issuer.href.replace(/\/$/, ""),
        subject: "subject-1",
        email: "person@example.test",
        emailVerified: true,
        assurance: "active-session",
      },
      Math.floor(Date.now() / 1000) - 1,
    );
    cookies.get.mockReturnValue({ value: token });
    await expect(new OidcSessionVerifier(configuration).verify()).resolves.toBeNull();
  });
});
