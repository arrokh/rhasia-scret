import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "@/modules/crypto/application/redact-sensitive-data";

describe("redactSensitiveData", () => {
  it("removes sensitive material recursively before diagnostics", () => {
    expect(redactSensitiveData({ event: "unlock", vaultKey: "key", detail: { otp: "123456", visible: true } })).toEqual(
      {
        event: "unlock",
        vaultKey: "[REDACTED]",
        detail: { otp: "[REDACTED]", visible: true },
      },
    );
  });
});
