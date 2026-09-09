import { describe, expect, it } from "vitest";
import { generateTotp, hasClockDrift, parseTotpUri } from "@/modules/otp-runtime";
import { rfcTotpUri } from "./totp-test-helpers";

describe("TOTP runtime", () => {
  it("parses a supported normalized TOTP URI", () => {
    const configuration = parseTotpUri(rfcTotpUri("algorithm=SHA1&digits=8&period=30"));
    expect(configuration).toMatchObject({
      issuer: "Example",
      accountName: "alice",
      algorithm: "SHA-1",
      digits: 8,
      period: 30,
    });
    expect(configuration.secret).toHaveLength(20);
  });

  it("rejects HOTP and unsupported TOTP parameters", () => {
    expect(() => parseTotpUri(rfcTotpUri().replace("otpauth://totp", "otpauth://hotp"))).toThrow("totpOnly");
    expect(() => parseTotpUri(rfcTotpUri("digits=7"))).toThrow("unsupportedDigits");
    expect(() => parseTotpUri(rfcTotpUri().replace("Example:alice", "%E0%A4%A"))).toThrow("invalidLabel");
  });

  it("formats an RFC 4226 dynamic-truncation value", async () => {
    const configuration = parseTotpUri(rfcTotpUri());
    const code = await generateTotp(
      configuration,
      {
        sign: async () =>
          new Uint8Array([
            0xcc, 0x93, 0xcf, 0x18, 0x50, 0x8d, 0x94, 0x93, 0x4c, 0x64, 0xb6, 0x5d, 0x8b, 0xa7, 0x66, 0x7f, 0xb7, 0xcd,
            0xe4, 0xb0,
          ]),
      },
      new Date(0),
    );
    expect(code.value).toBe("755224");
    expect(code.validUntil).toEqual(new Date(30_000));
  });

  it("warns only when clock drift exceeds thirty seconds", () => {
    expect(hasClockDrift(new Date(0), new Date(30_000))).toBe(false);
    expect(hasClockDrift(new Date(0), new Date(30_001))).toBe(true);
  });
});
