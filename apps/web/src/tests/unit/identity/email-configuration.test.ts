import { describe, expect, it } from "vitest";
import { readEmailConfiguration } from "@/modules/identity/infrastructure/email-configuration";

const valid = {
  NODE_ENV: "test",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASSWORD: "smtp-password",
  AUTH_EMAIL_FROM: "no-reply@example.test",
  AUTH_EMAIL_FROM_NAME: "rhasia-scret",
};

describe("email delivery configuration", () => {
  it("reads server-only SMTP configuration", () => {
    expect(readEmailConfiguration(valid)).toEqual({
      smtp: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        requireTls: true,
        user: "smtp-user",
        password: "smtp-password",
      },
      from: { address: "no-reply@example.test", name: "rhasia-scret" },
    });
  });

  it("requires implicit TLS for port 465 and STARTTLS otherwise", () => {
    expect(() => readEmailConfiguration({ ...valid, SMTP_PORT: "465", SMTP_SECURE: "false" })).toThrow("SMTP_PORT 465");
    expect(() => readEmailConfiguration({ ...valid, SMTP_PORT: "587", SMTP_REQUIRE_TLS: "false" })).toThrow(
      "SMTP_REQUIRE_TLS",
    );
  });

  it("rejects malformed sender values", () => {
    expect(() => readEmailConfiguration({ ...valid, AUTH_EMAIL_FROM: "bad\n@example.test" })).toThrow(
      "AUTH_EMAIL_FROM",
    );
    expect(() => readEmailConfiguration({ ...valid, SMTP_HOST: "smtp host" })).toThrow("SMTP_HOST");
  });
});
