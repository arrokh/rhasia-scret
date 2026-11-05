import { describe, expect, it } from "vitest";
import { generateTotp, parseTotpUri, type TotpAlgorithm, type TotpConfiguration } from "@/modules/otp-runtime";
import { BrowserHmacGenerator } from "@/modules/otp-runtime/infrastructure/browser-hmac-generator";
import { rfcTotpUri } from "./totp-test-helpers";

type Rfc6238Sha2Vector = {
  algorithm: TotpAlgorithm;
  secret: string;
  secretLength: number;
  answers: Array<{ timeSeconds: number; code: string }>;
};

const sha2Vectors: Rfc6238Sha2Vector[] = [
  {
    algorithm: "SHA-256",
    secret: "12345678901234567890123456789012",
    secretLength: 32,
    answers: [
      { timeSeconds: 59, code: "46119246" },
      { timeSeconds: 1_111_111_109, code: "68084774" },
      { timeSeconds: 1_111_111_111, code: "67062674" },
      { timeSeconds: 1_234_567_890, code: "91819424" },
      { timeSeconds: 2_000_000_000, code: "90698825" },
      { timeSeconds: 20_000_000_000, code: "77737706" },
    ],
  },
  {
    algorithm: "SHA-512",
    secret: "1234567890123456789012345678901234567890123456789012345678901234",
    secretLength: 64,
    answers: [
      { timeSeconds: 59, code: "90693936" },
      { timeSeconds: 1_111_111_109, code: "25091201" },
      { timeSeconds: 1_111_111_111, code: "99943326" },
      { timeSeconds: 1_234_567_890, code: "93441116" },
      { timeSeconds: 2_000_000_000, code: "38618901" },
      { timeSeconds: 20_000_000_000, code: "47863826" },
    ],
  },
];

describe("BrowserHmacGenerator", () => {
  it("generates the RFC 6238 SHA-1 test vector locally", async () => {
    const configuration = parseTotpUri(rfcTotpUri("algorithm=SHA1&digits=8&period=30"));
    const code = await generateTotp(configuration, new BrowserHmacGenerator(), new Date(59_000));
    expect(code.value).toBe("94287082");
  });

  it.each(sha2Vectors)("matches the RFC 6238 $algorithm known-answer vectors", async (vector) => {
    const secret = new TextEncoder().encode(vector.secret);
    expect(secret).toHaveLength(vector.secretLength);

    const configuration: TotpConfiguration = {
      issuer: "Example",
      accountName: "rfc6238-vector",
      secret,
      algorithm: vector.algorithm,
      digits: 8,
      period: 30,
    };
    try {
      for (const answer of vector.answers) {
        const code = await generateTotp(
          configuration,
          new BrowserHmacGenerator(),
          new Date(answer.timeSeconds * 1_000),
        );
        expect(code.value).toBe(answer.code);
      }
    } finally {
      secret.fill(0);
    }
  });
});
