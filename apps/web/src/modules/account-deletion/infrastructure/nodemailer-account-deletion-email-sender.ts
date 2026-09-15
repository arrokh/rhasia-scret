import type { AccountDeletionEmailSender } from "../application/account-deletion-email";
import { renderAccountDeletionCompletionEmail, renderAccountDeletionOtpEmail } from "./account-deletion-email-template";
import { readEmailConfiguration } from "@/modules/identity/server";
import { createNodemailerTransport, type TransportFactory } from "@/shared/infrastructure/nodemailer-transport";

export function createNodemailerAccountDeletionEmailSender(
  createTransport?: TransportFactory,
): AccountDeletionEmailSender {
  const configuration = readEmailConfiguration();
  const transporter = createNodemailerTransport(configuration.smtp, createTransport);
  const send = async (
    email:
      | Parameters<AccountDeletionEmailSender["sendDeletionOtpEmail"]>[0]
      | Parameters<AccountDeletionEmailSender["sendDeletionCompletionEmail"]>[0],
  ): Promise<void> => {
    const content = "otp" in email ? renderAccountDeletionOtpEmail(email) : renderAccountDeletionCompletionEmail(email);
    await transporter.sendMail({
      from: { address: configuration.from.address, name: configuration.from.name },
      to: email.recipientEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  };
  return {
    sendDeletionOtpEmail: (email) => send(email),
    sendDeletionCompletionEmail: (email) => send(email),
  };
}
