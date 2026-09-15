import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export type MailTransport = Readonly<{
  sendMail(options: SendMailOptions): Promise<unknown>;
}>;

export type TransportFactory = (options: SMTPTransport.Options) => MailTransport;

type SmtpConfiguration = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
}>;

export function createNodemailerTransport(
  configuration: SmtpConfiguration,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
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
