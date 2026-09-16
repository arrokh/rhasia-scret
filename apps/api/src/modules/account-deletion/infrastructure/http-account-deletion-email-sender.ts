import type {
  AccountDeletionCompletionEmail,
  AccountDeletionEmailSender,
  AccountDeletionOtpEmail,
} from "../application/account-deletion-email";
import { renderAccountDeletionCompletionEmail, renderAccountDeletionOtpEmail } from "./account-deletion-email-template";
import type { ApiBindings } from "@api/types";

const EMAIL_TIMEOUT_MS = 5_000;

type EmailContent = Readonly<{ subject: string; text: string; html: string }>;

export function createHttpAccountDeletionEmailSender(bindings: ApiBindings): AccountDeletionEmailSender {
  const endpoint = required(bindings.EMAIL_PROVIDER_URL, "EMAIL_PROVIDER_URL");
  const token = required(bindings.EMAIL_PROVIDER_TOKEN, "EMAIL_PROVIDER_TOKEN");
  const from = required(bindings.AUTH_EMAIL_FROM, "AUTH_EMAIL_FROM");
  const fromName = bindings.AUTH_EMAIL_FROM_NAME?.trim() || "rhasia-scret";
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname)))
    throw new Error("EMAIL_PROVIDER_URL must use HTTPS.");

  return {
    sendDeletionOtpEmail: (email) =>
      send({ recipientEmail: email.recipientEmail, content: renderAccountDeletionOtpEmail(email) }),
    sendDeletionCompletionEmail: (email) =>
      send({ recipientEmail: email.recipientEmail, content: renderAccountDeletionCompletionEmail(email) }),
  };

  async function send(input: Readonly<{ recipientEmail: string; content: EmailContent }>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: { email: from, name: fromName },
          to: [{ email: input.recipientEmail }],
          subject: input.content.subject,
          text: input.content.text,
          html: input.content.html,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Email provider rejected the message.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export type { AccountDeletionOtpEmail, AccountDeletionCompletionEmail };
