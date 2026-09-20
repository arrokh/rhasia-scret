import { describe, expect, it } from "vitest";
import { createE2eSessionVerifier } from "@api/modules/identity/infrastructure/e2e-session-verifier";

const bindings = {
  NODE_ENV: "development",
  E2E_BROWSER_TESTS: "1",
  E2E_BROWSER_TEST_USERS: JSON.stringify({
    "e2e-chromium-personal-owner": { subject: "subject:e2e", email: "User@browser-e2e.test" },
  }),
};

const request = (cookie?: string, proxy = true, authorization?: string) =>
  new Request("https://api.example.test/v1/me", {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(proxy ? { "x-rhasia-proxy-secret": "validated-by-app-middleware" } : {}),
      ...(authorization ? { authorization } : {}),
    },
  });

describe("development browser E2E session verifier", () => {
  it("maps only configured proxy-forwarded test cookies to active principals", async () => {
    const verifier = createE2eSessionVerifier(bindings);
    if (!verifier) throw new Error("Expected the E2E verifier to be enabled.");
    await expect(verifier.verify(request("rhsia-e2e-session=e2e-chromium-personal-owner"))).resolves.toMatchObject({
      issuer: "e2e",
      subject: "subject:e2e",
      email: "user@browser-e2e.test",
      assurance: "active-session",
      sessionId: "e2e:e2e-chromium-personal-owner",
    });
  });

  it("is disabled outside the development E2E configuration and rejects direct cookies", async () => {
    expect(createE2eSessionVerifier({ ...bindings, NODE_ENV: "production" })).toBeNull();
    const verifier = createE2eSessionVerifier(bindings);
    if (!verifier) throw new Error("Expected the E2E verifier to be enabled.");
    await expect(verifier.verify(request("rhsia-e2e-session=e2e-chromium-personal-owner", false))).resolves.toBeNull();
    await expect(verifier.verify(request("rhsia-e2e-session=unknown"))).resolves.toBeNull();
    await expect(
      verifier.verify(request("rhsia-e2e-session=e2e-chromium-personal-owner", true, "Bearer access-token")),
    ).resolves.toBeNull();
  });
});
