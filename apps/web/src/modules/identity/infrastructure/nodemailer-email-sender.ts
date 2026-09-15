import type { MagicLinkEmail, MagicLinkEmailSender } from "../application/email-delivery";
import { renderMagicLinkEmail } from "@/shared/infrastructure/email-templates";
import type { EmailConfiguration } from "./email-configuration";
import { createNodemailerTransport, type TransportFactory } from "@/shared/infrastructure/nodemailer-transport";

export function createNodemailerEmailSender(
  configuration: EmailConfiguration,
  createTransport?: TransportFactory,
): MagicLinkEmailSender {
  const transporter = createNodemailerTransport(configuration.smtp, createTransport);
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
