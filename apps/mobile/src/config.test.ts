import { parseMobileClientConfiguration } from "./config";

const valid = {
  apiUrl: "https://api.example.test/",
  webOrigin: "https://vault.example.test/",
  authRedirectUrl: "https://vault.example.test/auth/mobile",
};

describe("mobile public configuration", () => {
  it("accepts only public HTTPS service endpoints and a verified callback", () => {
    expect(parseMobileClientConfiguration(valid)).toEqual({
      apiUrl: "https://api.example.test",
      webOrigin: "https://vault.example.test",
      authRedirectUrl: "https://vault.example.test/auth/mobile",
    });
  });

  it("allows the registered custom callback scheme for development builds", () => {
    expect(
      parseMobileClientConfiguration({ ...valid, authRedirectUrl: "rhasia-scret://auth/magic-link" }).authRedirectUrl,
    ).toBe("rhasia-scret://auth/magic-link");
  });

  it.each([
    [{ ...valid, apiUrl: "http://rhasia-scret.invalid" }, "EXPO_PUBLIC_API_URL uses an unsupported protocol."],
    [
      { ...valid, apiUrl: "https://username:password@api.example.test" },
      "Public service URLs must contain only an origin and no credentials.",
    ],
    [
      { ...valid, authRedirectUrl: "https://attacker.invalid/auth/mobile" },
      "EXPO_PUBLIC_AUTH_REDIRECT_URL is not an approved callback.",
    ],
    [
      { ...valid, authRedirectUrl: "rhasia-scret://auth:443/magic-link" },
      "EXPO_PUBLIC_AUTH_REDIRECT_URL is not an approved callback.",
    ],
  ])("rejects unsafe or incomplete public configuration", (configuration, message) => {
    expect(() => parseMobileClientConfiguration(configuration)).toThrow(message);
  });
});
