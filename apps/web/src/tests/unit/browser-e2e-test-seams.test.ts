import { afterEach, describe, expect, it, vi } from "vitest";
import { browserE2eAuthenticationVerified, browserE2eRegistrationCredential } from "@/modules/identity/infrastructure/browser-e2e-passkey-verification";
import { browserE2eTestSession } from "@/modules/identity/infrastructure/browser-e2e-test-session";

afterEach(() => vi.unstubAllEnvs());

describe("browser E2E test seams", () => {
  it("accepts only explicitly configured development sessions", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_BROWSER_TESTS", "1");
    vi.stubEnv("E2E_BROWSER_TEST_USERS", JSON.stringify({ invited: { subject: "subject:invited", email: "Invited@Example.Test" } }));

    expect(browserE2eTestSession("invited")).toEqual({ issuer: "e2e", subject: "subject:invited", email: "invited@example.test", emailVerified: true, assurance: "active-session", sessionId: "e2e:invited" });
    expect(browserE2eTestSession("unknown")).toBeNull();
  });

  it("cannot enable controlled sessions or verification in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_BROWSER_TESTS", "1");
    vi.stubEnv("E2E_BROWSER_TEST_USERS", JSON.stringify({ invited: { subject: "subject:invited", email: "invited@example.test" } }));

    expect(browserE2eTestSession("invited")).toBeNull();
    expect(browserE2eRegistrationCredential(registrationResponse())).toBeNull();
    expect(browserE2eAuthenticationVerified(authenticationResponse(), Uint8Array.of(1, 2, 3, 4))).toBe(false);
  });

  it("accepts deterministic credential responses only behind the development gate", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_BROWSER_TESTS", "1");
    const registration = browserE2eRegistrationCredential(registrationResponse());

    expect(registration).toEqual({ credentialId: Uint8Array.of(1, 2, 3, 4), publicKey: Uint8Array.of(1, 2, 3, 4), transports: ["internal"] });
    expect(browserE2eAuthenticationVerified(authenticationResponse(), Uint8Array.of(1, 2, 3, 4))).toBe(true);
    expect(browserE2eAuthenticationVerified({ ...authenticationResponse(), id: "wrong" }, Uint8Array.of(1, 2, 3, 4))).toBe(false);
  });
});

function registrationResponse() {
  return { id: "AQIDBA", type: "public-key", clientExtensionResults: { browserE2eTest: true, prf: { enabled: true } } };
}

function authenticationResponse() {
  return { id: "AQIDBA", type: "public-key", response: { userHandle: undefined }, clientExtensionResults: { browserE2eTest: true } };
}
