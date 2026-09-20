import { describe, expect, it, vi } from "vitest";
import {
  createSmtpEmailSenders,
  readSmtpEmailConfiguration,
  type MailTransport,
  type NodemailerTransportFactory,
} from "@api/smtp-email-senders";

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

describe("SMTP email delivery", () => {
  it("reads server-only SMTP configuration", () => {
    expect(readSmtpEmailConfiguration(valid)).toEqual({
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
    expect(() => readSmtpEmailConfiguration({ ...valid, SMTP_PORT: "465", SMTP_SECURE: "false" })).toThrow(
      "SMTP_PORT 465",
    );
    expect(() => readSmtpEmailConfiguration({ ...valid, SMTP_PORT: "587", SMTP_REQUIRE_TLS: "false" })).toThrow(
      "SMTP_REQUIRE_TLS",
    );
  });

  it("rejects malformed sender values", () => {
    expect(() => readSmtpEmailConfiguration({ ...valid, AUTH_EMAIL_FROM: "bad\n@example.test" })).toThrow(
      "AUTH_EMAIL_FROM",
    );
    expect(() => readSmtpEmailConfiguration({ ...valid, SMTP_HOST: "smtp host" })).toThrow("SMTP_HOST");
  });

  it("sends magic-link and account-deletion messages through one locked-down SMTP transport", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "message-id" });
    const createTransport: NodemailerTransportFactory = vi.fn().mockReturnValue({ sendMail } satisfies MailTransport);
    const senders = createSmtpEmailSenders(valid, createTransport);

    await senders.magicLink?.sendMagicLinkEmail({
      recipientEmail: "person@example.test",
      actionUrl: new URL(
        "https://vault.example.test/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      ),
    });
    await senders.accountDeletion?.sendDeletionOtpEmail({
      recipientEmail: "person@example.test",
      otp: "123456",
    });
    await senders.accountDeletion?.sendDeletionCompletionEmail({
      recipientEmail: "person@example.test",
      receiptId: "receipt-123",
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "smtp-user", pass: "smtp-password" },
        disableFileAccess: true,
        disableUrlAccess: true,
        maxRecipients: 1,
      }),
    );
    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: { address: "no-reply@example.test", name: "rhasia-scret" },
        to: "person@example.test",
        text: expect.stringContaining("https://vault.example.test/auth/confirm#token="),
      }),
    );
    expect(sendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: { address: "no-reply@example.test", name: "rhasia-scret" },
        to: "person@example.test",
        text: expect.stringContaining("123456"),
      }),
    );
    expect(sendMail).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        from: { address: "no-reply@example.test", name: "rhasia-scret" },
        to: "person@example.test",
      }),
    );
  });
});
