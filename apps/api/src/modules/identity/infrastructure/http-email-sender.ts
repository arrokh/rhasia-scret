import type { MagicLinkEmail, MagicLinkEmailSender } from "../application/email-delivery";
import { renderMagicLinkEmail } from "@api/shared/infrastructure/email-templates";
import type { ApiBindings } from "@api/types";

const EMAIL_TIMEOUT_MS = 5_000;

export function createHttpEmailSender(bindings: ApiBindings): MagicLinkEmailSender {
  const endpoint = requiredBinding(bindings.EMAIL_PROVIDER_URL, "EMAIL_PROVIDER_URL");
  const token = requiredBinding(bindings.EMAIL_PROVIDER_TOKEN, "EMAIL_PROVIDER_TOKEN");
  const from = requiredBinding(bindings.AUTH_EMAIL_FROM, "AUTH_EMAIL_FROM");
  const fromName = bindings.AUTH_EMAIL_FROM_NAME?.trim() || "rhasia-scret";
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname)))
    throw new Error("EMAIL_PROVIDER_URL must use HTTPS.");
  if (/[\r\n]/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error("AUTH_EMAIL_FROM is invalid.");
  if (/[\r\n]/.test(fromName)) throw new Error("AUTH_EMAIL_FROM_NAME is invalid.");

  return {
    async sendMagicLinkEmail(email: MagicLinkEmail): Promise<void> {
      const content = renderMagicLinkEmail(email.actionUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: { email: from, name: fromName },
            to: [{ email: email.recipientEmail }],
            subject: content.subject,
            text: content.text,
            html: content.html,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Email provider rejected the message.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new Error("Email provider timed out.");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function requiredBinding(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
