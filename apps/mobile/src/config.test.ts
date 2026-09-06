import { parseMobileClientConfiguration } from "./config";

const valid = {
  apiUrl: "https://api.example.test/",
  webOrigin: "https://vault.example.test/",
  authRedirectUrl: "https://vault.example.test/auth/mobile",
  supabaseUrl: "https://project.supabase.co/",
  supabasePublishableKey: "publishable-key",
};

describe("mobile public configuration", () => {
  it("accepts only public HTTPS service endpoints and a verified callback", () => {
    expect(parseMobileClientConfiguration(valid)).toEqual({
      apiUrl: "https://api.example.test",
      webOrigin: "https://vault.example.test",
      authRedirectUrl: "https://vault.example.test/auth/mobile",
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "publishable-key",
    });
  });

  it("allows the registered custom callback scheme for development builds", () => {
    expect(parseMobileClientConfiguration({ ...valid, authRedirectUrl: "rhasia-scret://auth/callback" }).authRedirectUrl).toBe("rhasia-scret://auth/callback");
  });

  it.each([
    [{ ...valid, apiUrl: "http://rhasia-scret.invalid" }, "EXPO_PUBLIC_API_URL uses an unsupported protocol."],
    [{ ...valid, supabaseUrl: "https://username:password@project.supabase.co" }, "Public service URLs must not contain credentials."],
    [{ ...valid, supabasePublishableKey: "" }, "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required."],
    [{ ...valid, authRedirectUrl: "https://attacker.invalid/auth/mobile" }, "EXPO_PUBLIC_AUTH_REDIRECT_URL is not an approved callback."],
  ])("rejects unsafe or incomplete public configuration", (configuration, message) => {
    expect(() => parseMobileClientConfiguration(configuration)).toThrow(message);
  });
});
