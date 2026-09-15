import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { MagicLinkEmail, MagicLinkEmailSender } from "../application/email-delivery";
import { renderMagicLinkEmail } from "@/shared/infrastructure/email-templates";
import type { EmailConfiguration } from "./email-configuration";

type MailTransport = Readonly<{
  sendMail(options: SendMailOptions): Promise<unknown>;
}>;

type TransportFactory = (options: SMTPTransport.Options) => MailTransport;

export function createNodemailerEmailSender(
  configuration: EmailConfiguration,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
): MagicLinkEmailSender {
  const transporter = createTransport({
    host: configuration.smtp.host,
    port: configuration.smtp.port,
    secure: configuration.smtp.secure,
    requireTLS: configuration.smtp.requireTls && !configuration.smtp.secure,
    auth: { user: configuration.smtp.user, pass: configuration.smtp.password },
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2" },
  });

  return {
    async sendMagicLinkEmail(email: MagicLinkEmail): Promise<void> {
      const content = renderMagicLinkEmail(email.actionUrl);
      await transporter.sendMail({
        from: { address: configuration.from.address, name: configuration.from.name },
        to: email.recipientEmail,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    },
  };
}
