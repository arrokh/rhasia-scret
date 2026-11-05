import { describe, expect, it } from "vitest";
import { generateTotp, parseTotpUri, type HmacGenerator } from "../src/index";

const periodMilliseconds = 45_000;
const rolloverTime = 256 * periodMilliseconds;

const counterBoundaryCases = [
  {
    time: rolloverTime - 1,
    counterBytes: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]),
    validUntil: rolloverTime,
  },
  {
    time: rolloverTime,
    counterBytes: new Uint8Array([0, 0, 0, 0, 0, 0, 1, 0]),
    validUntil: rolloverTime + periodMilliseconds,
  },
];

describe("generateTotp", () => {
  it.each(counterBoundaryCases)("encodes the counter and expiry around a 45-second rollover", async (testCase) => {
    const counterMessages: Uint8Array[] = [];
    const hmac: HmacGenerator = {
      sign: async (_algorithm, _secret, message) => {
        counterMessages.push(message.slice());
        return new Uint8Array(20);
      },
    };

    const code = await generateTotp(totpConfiguration(), hmac, new Date(testCase.time));

    expect(counterMessages).toEqual([testCase.counterBytes]);
    expect(code.validUntil).toEqual(new Date(testCase.validUntil));
  });

  it.each([
    { label: "invalid", now: new Date(Number.NaN) },
    { label: "negative", now: new Date(-1) },
  ])("rejects $label time before requesting an HMAC", async ({ now }) => {
    const counterMessages: Uint8Array[] = [];
    const hmac: HmacGenerator = {
      sign: async (_algorithm, _secret, message) => {
        counterMessages.push(message.slice());
        return new Uint8Array(20);
      },
    };

    await expect(generateTotp(totpConfiguration(), hmac, now)).rejects.toThrow("A valid time is required.");
    expect(counterMessages).toEqual([]);
  });

  it("rejects an HMAC digest shorter than twenty bytes", async () => {
    const hmac: HmacGenerator = { sign: async () => new Uint8Array(19) };

    await expect(generateTotp(totpConfiguration(), hmac, new Date(0))).rejects.toThrow("The HMAC digest is too short.");
  });
});

function totpConfiguration() {
  return parseTotpUri(
    "otpauth://totp/Example:alice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=45",
  );
}
