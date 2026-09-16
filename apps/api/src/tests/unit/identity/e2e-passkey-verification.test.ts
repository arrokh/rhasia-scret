import { describe, expect, it } from "vitest";
import {
  browserE2eAuthenticationVerified,
  browserE2eRegistrationCredential,
} from "@api/modules/identity/infrastructure/e2e-passkey-verification";

describe("API browser E2E passkey seams", () => {
  const bindings = { NODE_ENV: "development", E2E_BROWSER_TESTS: "1" } as const;
  const registration = {
    id: "AQIDBA",
    type: "public-key",
    clientExtensionResults: { browserE2eTest: true, prf: { enabled: true } },
  };
  const authentication = {
    id: "AQIDBA",
    type: "public-key",
    response: { userHandle: undefined },
    clientExtensionResults: { browserE2eTest: true },
  };

  it("accepts deterministic credentials only in development browser E2E mode", () => {
    expect(browserE2eRegistrationCredential(registration, bindings)).toEqual({
      credentialId: Uint8Array.of(1, 2, 3, 4),
      publicKey: Uint8Array.of(1, 2, 3, 4),
      transports: ["internal"],
    });
    expect(browserE2eAuthenticationVerified(authentication, Uint8Array.of(1, 2, 3, 4), bindings)).toBe(true);
  });

  it("fails closed outside development browser E2E mode", () => {
    const production = { NODE_ENV: "production", E2E_BROWSER_TESTS: "1" } as const;
    expect(browserE2eRegistrationCredential(registration, production)).toBeNull();
    expect(browserE2eAuthenticationVerified(authentication, Uint8Array.of(1, 2, 3, 4), production)).toBe(false);
  });
});
