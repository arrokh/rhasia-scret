import { describe, expect, it } from "vitest";
import { generateTotp, parseTotpUri } from "@/modules/otp-runtime";
import { BrowserHmacGenerator } from "@/modules/otp-runtime/infrastructure/browser-hmac-generator";
import { rfcTotpUri } from "./totp-test-helpers";

describe("BrowserHmacGenerator", () => {
  it("generates the RFC 6238 SHA-1 test vector locally", async () => {
    const configuration = parseTotpUri(rfcTotpUri("algorithm=SHA1&digits=8&period=30"));
    const code = await generateTotp(configuration, new BrowserHmacGenerator(), new Date(59_000));
    expect(code.value).toBe("94287082");
  });
});
