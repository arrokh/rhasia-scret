import { describe, expect, it, vi } from "vitest";
import { readEmailConfiguration } from "@/modules/identity/infrastructure/email-configuration";
import { createNodemailerEmailSender } from "@/modules/identity/infrastructure/nodemailer-email-sender";

const configuration = readEmailConfiguration({
  NODE_ENV: "test",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASSWORD: "smtp-password",
  AUTH_EMAIL_FROM: "no-reply@example.test",
  AUTH_EMAIL_FROM_NAME: "rhasia-scret",
});

describe("Nodemailer magic-link sender", () => {
  it("creates a locked-down SMTP transport and sends the rendered message", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "message-id" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const sender = createNodemailerEmailSender(configuration, createTransport);

    await sender.sendMagicLinkEmail({
      recipientEmail: "person@example.test",
      actionUrl: new URL(
        "https://vault.example.test/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      ),
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
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { address: "no-reply@example.test", name: "rhasia-scret" },
        to: "person@example.test",
        text: expect.stringContaining(
          "https://vault.example.test/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
        ),
        html: expect.stringContaining("Sign in to rhasia-scret"),
      }),
    );
  });
});
