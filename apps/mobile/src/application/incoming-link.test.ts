import { classifyIncomingLink, completeAuthCallback, extractSecureShareLinkSecret, type MobileAuthCallbackPort } from "./incoming-link";

function authPort(): jest.Mocked<MobileAuthCallbackPort> {
  return {
    exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
    setSession: jest.fn().mockResolvedValue({ error: null }),
  };
}

describe("incoming mobile links", () => {
  const webOrigin = "https://vault.example.test";

  it.each([
    "rhasia-scret://auth/callback?code=pkce-code",
    `${webOrigin}/auth/mobile?code=pkce-code`,
  ])("recognizes an approved authentication callback: %s", (url) => {
    expect(classifyIncomingLink(url, webOrigin)).toBe("auth_callback");
  });

  it("recognizes the verified Secure Share Link and extracts its client-only fragment explicitly", () => {
    const url = `${webOrigin}/vaults/invitations/redeem#client-only-secret`;
    expect(classifyIncomingLink(url, webOrigin)).toBe("secure_share_link");
    expect(extractSecureShareLinkSecret(url, webOrigin)).toBe("client-only-secret");
    expect(extractSecureShareLinkSecret("https://attacker.invalid/vaults/invitations/redeem#client-only-secret", webOrigin)).toBeNull();
  });

  it.each([
    "https://attacker.invalid/auth/mobile?code=stolen",
    "http://vault.example.test/auth/mobile?code=stolen",
    "not-a-url",
  ])("rejects an untrusted callback: %s", (url) => {
    expect(classifyIncomingLink(url, webOrigin)).toBe("unknown");
  });

  it("exchanges a PKCE code without exposing it in the result", async () => {
    const auth = authPort();
    await expect(completeAuthCallback("rhasia-scret://auth/callback?code=pkce-code", auth, webOrigin)).resolves.toBe("authenticated");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("supports provider token callbacks only when both tokens are present", async () => {
    const auth = authPort();
    await expect(completeAuthCallback("rhasia-scret://auth/callback#access_token=access&refresh_token=refresh", auth, webOrigin)).resolves.toBe("authenticated");
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    await expect(completeAuthCallback("rhasia-scret://auth/callback#access_token=access", auth, webOrigin)).resolves.toBe("invalid");
  });
});
