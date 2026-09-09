import { describe, expect, it } from "vitest";
import { NoneSessionVerifier } from "@/modules/identity/infrastructure/none-session-verifier";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";

describe("provider-neutral session contract", () => {
  it("requires a normalized immutable issuer/subject and verified email for an admitted session", async () => {
    const verifier = new FakeSessionVerifier({
      issuer: "https://issuer.example.test",
      subject: "subject-1",
      email: "Person@Example.Test",
      emailVerified: true,
      assurance: "active-session",
      sessionId: "session-1",
    });
    await expect(verifier.verify("active-session")).resolves.toEqual({
      issuer: "https://issuer.example.test",
      subject: "subject-1",
      email: "Person@Example.Test",
      emailVerified: true,
      assurance: "active-session",
      sessionId: "session-1",
    });
    await expect(verifier.verify("active-session")).resolves.not.toBeNull();
  });

  it.each([
    [
      "missing assurance",
      { issuer: "issuer", subject: "subject", email: "person@example.test", assurance: "verified-claims" as const },
      "active-session" as const,
    ],
    [
      "unverified email",
      {
        issuer: "issuer",
        subject: "subject",
        email: "person@example.test",
        emailVerified: false,
        assurance: "active-session" as const,
      },
      "active-session" as const,
    ],
  ])("fails closed for %s", async (_name, principal, assurance) => {
    const verifier = new FakeSessionVerifier(principal);
    if ("emailVerified" in principal && principal.emailVerified === false)
      await expect(verifier.verify()).resolves.toBeNull();
    else await expect(verifier.verify(assurance)).resolves.toBeNull();
  });

  it("makes the local-only backend unable to verify a remote principal", async () => {
    await expect(new NoneSessionVerifier().verify()).resolves.toBeNull();
  });
});
