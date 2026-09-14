export type EmailConfiguration = Readonly<{
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

export function readEmailConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailConfiguration {
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
  if (email.length > 254 || /[\r\n]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must be a valid email address.`);
  }
  return email;
}

function readHeaderValue(value: string, name: string): string {
  if (!value || /[\r\n]/.test(value)) throw new Error(`${name} must not be empty or contain newlines.`);
  return value;
}
