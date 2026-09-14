import {
  classifyIncomingLink,
  completeMagicLink,
  extractMagicLinkToken,
  extractSecureShareLinkSecret,
} from "./incoming-link";

describe("incoming mobile links", () => {
  const webOrigin = "https://vault.example.test";

  it.each([
    "rhasia-scret://auth/magic-link#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    `${webOrigin}/auth/mobile#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK`,
  ])("recognizes an approved magic link: %s", (url) => {
    expect(classifyIncomingLink(url, webOrigin)).toBe("magic_link");
  });

  it("extracts only the approved magic-link token", () => {
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK";
    expect(extractMagicLinkToken(`${webOrigin}/auth/mobile#token=${token}`, webOrigin)).toBe(token);
    expect(extractMagicLinkToken(`${webOrigin}/auth/mobile#token=${token}&next=%2Fvaults`, webOrigin)).toBe(token);
    expect(
      extractMagicLinkToken(`${webOrigin}/auth/mobile#token=${token}&next=https%3A%2F%2Fattacker.invalid`, webOrigin),
    ).toBeNull();
    expect(extractMagicLinkToken(`${webOrigin}/auth/mobile#token=${token}&secret=unexpected`, webOrigin)).toBeNull();
    expect(extractMagicLinkToken("https://attacker.invalid/auth/mobile#token=" + token, webOrigin)).toBeNull();
  });

  it("recognizes the verified Secure Share Link and extracts its client-only fragment explicitly", () => {
    const url = `${webOrigin}/vaults/invitations/redeem#client-only-secret`;
    expect(classifyIncomingLink(url, webOrigin)).toBe("secure_share_link");
    expect(extractSecureShareLinkSecret(url, webOrigin)).toBe("client-only-secret");
    expect(
      extractSecureShareLinkSecret("https://attacker.invalid/vaults/invitations/redeem#client-only-secret", webOrigin),
    ).toBeNull();
  });

  it.each([
    "https://attacker.invalid/auth/mobile#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    "https://user@vault.example.test/auth/mobile#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    "http://vault.example.test/auth/mobile#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    "rhasia-scret://auth:443/magic-link#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    "not-a-url",
  ])("rejects an untrusted link: %s", (url) => {
    expect(classifyIncomingLink(url, webOrigin)).toBe("unknown");
  });

  it("redeems a magic link without returning its token", async () => {
    const auth = { redeemMagicLink: jest.fn().mockResolvedValue({}) };
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK";
    await expect(completeMagicLink(`${webOrigin}/auth/mobile#token=${token}`, auth, webOrigin)).resolves.toBe(
      "authenticated",
    );
    expect(auth.redeemMagicLink).toHaveBeenCalledWith(token);
  });
});
