import { describe, expect, it } from "vitest";
import { generateTotp, parseTotpUri } from "../src/index";

describe("client vault core public API", () => {
  it("normalizes an otpauth URI and generates a code through the injected HMAC port", async () => {
    const configuration = parseTotpUri("otpauth://totp/Example:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&period=30&digits=8&algorithm=SHA1");
    expect(configuration).toMatchObject({ issuer: "Example", accountName: "alice@example.com", digits: 8, period: 30 });
    const result = await generateTotp(configuration, { sign: async () => Uint8Array.from({ length: 20 }, (_, index) => index === 3 ? 1 : 0) }, new Date(59_000));
    expect(result.value).toBe("00000001");
  });
});
