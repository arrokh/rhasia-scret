import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { ApiEmailSenders } from "@api/types";
import type { AccountDeletionEmailSender } from "@api/modules/account-deletion/application/account-deletion-email";
import type { MagicLinkEmailSender } from "@api/modules/identity/application/email-delivery";
import {
  renderAccountDeletionCompletionEmail,
  renderAccountDeletionOtpEmail,
} from "@api/modules/account-deletion/infrastructure/account-deletion-email-template";
import { renderMagicLinkEmail } from "@api/shared/infrastructure/email-templates";

export type MailTransport = Readonly<{
  sendMail(options: SendMailOptions): Promise<unknown>;
}>;

export type NodemailerTransportFactory = (options: SMTPTransport.Options) => MailTransport;

export type SmtpEnvironment = Readonly<{
  NODE_ENV?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_REQUIRE_TLS?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
}>;

export type SmtpEmailConfiguration = Readonly<{
  smtp: Readonly<{
    host: string;
    port: number;
    secure: boolean;
    requireTls: boolean;
    user: string;
    password: string;
  }>;
  from: Readonly<{
    address: string;
    name: string;
  }>;
}>;

export function createSmtpEmailSenders(
  env: SmtpEnvironment,
  createTransport: NodemailerTransportFactory = (options) => nodemailer.createTransport(options),
): ApiEmailSenders {
  const configuration = readSmtpEmailConfiguration(env);
  const transporter = createNodemailerTransport(configuration.smtp, createTransport);
  return {
    magicLink: createMagicLinkEmailSender(transporter, configuration),
    accountDeletion: createAccountDeletionEmailSender(transporter, configuration),
  };
}

export function createDisabledEmailSenders(): ApiEmailSenders {
  const unavailable = async (): Promise<void> => {
    throw new Error("Email delivery is unavailable.");
  };
  return {
    magicLink: { sendMagicLinkEmail: unavailable },
    accountDeletion: {
      sendDeletionOtpEmail: unavailable,
      sendDeletionCompletionEmail: unavailable,
    },
  };
}

export function readSmtpEmailConfiguration(env: SmtpEnvironment): SmtpEmailConfiguration {
  const production = env.NODE_ENV === "production";
  const smtpHost = readRequired(env.SMTP_HOST, "SMTP_HOST");
  if (/\s/.test(smtpHost)) throw new Error("SMTP_HOST must not contain whitespace.");
  const smtpPort = readPort(env.SMTP_PORT);
  const secure = readBoolean(env.SMTP_SECURE, "SMTP_SECURE");
  const requireTls = readBoolean(env.SMTP_REQUIRE_TLS ?? "true", "SMTP_REQUIRE_TLS");
  const user = readRequired(env.SMTP_USER, "SMTP_USER");
  const password = readRequired(env.SMTP_PASSWORD, "SMTP_PASSWORD", false);
  const address = readEmail(env.AUTH_EMAIL_FROM, "AUTH_EMAIL_FROM");
  const name = readHeaderValue(env.AUTH_EMAIL_FROM_NAME ?? "rhasia-scret", "AUTH_EMAIL_FROM_NAME");

  if (secure && smtpPort !== 465) throw new Error("SMTP_SECURE requires SMTP_PORT 465.");
  if (!secure && smtpPort === 465) throw new Error("SMTP_PORT 465 requires SMTP_SECURE=true.");
  if (!secure && !requireTls) throw new Error("SMTP_REQUIRE_TLS must be true for non-implicit TLS SMTP.");
  if (production && smtpPort === 25) throw new Error("SMTP_PORT 25 is not allowed in production.");

  return {
    smtp: { host: smtpHost, port: smtpPort, secure, requireTls, user, password },
    from: { address, name },
  };
}

function createMagicLinkEmailSender(
  transporter: MailTransport,
  configuration: SmtpEmailConfiguration,
): MagicLinkEmailSender {
  return {
    async sendMagicLinkEmail(email) {
      const content = renderMagicLinkEmail(email.actionUrl);
      await sendMail(transporter, {
        from: { address: configuration.from.address, name: configuration.from.name },
        to: email.recipientEmail,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    },
  };
}

function createAccountDeletionEmailSender(
  transporter: MailTransport,
  configuration: SmtpEmailConfiguration,
): AccountDeletionEmailSender {
  const send = async (
    email:
      | Parameters<AccountDeletionEmailSender["sendDeletionOtpEmail"]>[0]
      | Parameters<AccountDeletionEmailSender["sendDeletionCompletionEmail"]>[0],
  ): Promise<void> => {
    const content = "otp" in email ? renderAccountDeletionOtpEmail(email) : renderAccountDeletionCompletionEmail(email);
    await sendMail(transporter, {
      from: { address: configuration.from.address, name: configuration.from.name },
      to: email.recipientEmail,
      ...content,
    });
  };
  return {
    sendDeletionOtpEmail: (email) => send(email),
    sendDeletionCompletionEmail: (email) => send(email),
  };
}

async function sendMail(transporter: MailTransport, options: SendMailOptions): Promise<void> {
  await transporter.sendMail(options);
}

function createNodemailerTransport(
  configuration: SmtpEmailConfiguration["smtp"],
  createTransport: NodemailerTransportFactory,
): MailTransport {
  return createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: configuration.requireTls && !configuration.secure,
    auth: { user: configuration.user, pass: configuration.password },
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2" },
  });
}

function readRequired(value: string | undefined, name: string, trim = true): string {
  const normalized = trim ? value?.trim() : value;
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function readPort(value: string | undefined): number {
  const raw = readRequired(value, "SMTP_PORT");
  if (!/^\d+$/.test(raw)) throw new Error("SMTP_PORT must be a number between 1 and 65535.");
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("SMTP_PORT must be a number between 1 and 65535.");
  return port;
}

function readBoolean(value: string | undefined, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function readEmail(value: string | undefined, name: string): string {
  const email = readRequired(value, name);
  if (email.length > 254 || /[\r\n]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error(`${name} must be a valid email address.`);
  return email;
}

function readHeaderValue(value: string, name: string): string {
  if (!value || /[\r\n]/.test(value)) throw new Error(`${name} must not be empty or contain newlines.`);
  return value;
}
