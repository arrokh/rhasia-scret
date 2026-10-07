export type AuthBackend = "none" | "passwordless";
export type AuthConfigurationField =
  | "AUTH_BACKEND"
  | "AUTH_APP_ORIGIN"
  | "AUTH_MAGIC_LINK_SECRET"
  | "AUTH_SESSION_SECRET"
  | "AUTH_MAGIC_LINK_TTL_SECONDS"
  | "AUTH_ACCESS_TOKEN_TTL_SECONDS"
  | "AUTH_REFRESH_TOKEN_TTL_SECONDS"
  | "TURNSTILE_SECRET_KEY";

export class AuthenticationConfigurationError extends Error {
  public readonly code = "authentication_misconfigured" as const;

  public constructor(
    public readonly field: AuthConfigurationField,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationConfigurationError";
  }
}

export function isAuthenticationConfigurationError(error: unknown): error is AuthenticationConfigurationError {
  return error instanceof AuthenticationConfigurationError;
}

export type TurnstileConfiguration = Readonly<{
  secretKey: string;
  expectedAction?: "magic_link_request" | "test";
  expectedHostname?: string;
}>;
type TurnstileEnvironment = Readonly<{
  TURNSTILE_SECRET_KEY?: string;
  NODE_ENV?: string;
  WEB_ORIGIN?: string;
  AUTH_APP_ORIGIN?: string;
}>;

export type PasswordlessConfiguration = {
  appOrigin: URL;
  magicLinkSecret: Uint8Array;
  sessionSecret: Uint8Array;
  turnstile: TurnstileConfiguration;
  magicLinkTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

export type AuthConfiguration =
  { backend: "none" } | { backend: "passwordless"; passwordless: PasswordlessConfiguration };

export function readAuthConfiguration(env: Readonly<Record<string, string | undefined>>): AuthConfiguration {
  const configuredBackend = env.AUTH_BACKEND?.trim();
  if (!configuredBackend && env.NODE_ENV === "production")
    throw configurationError("AUTH_BACKEND", "AUTH_BACKEND must be set explicitly in production.");
  const backend = configuredBackend || "passwordless";
  if (backend === "none") return { backend };
  if (backend !== "passwordless")
    throw configurationError("AUTH_BACKEND", "AUTH_BACKEND must be none or passwordless.");
  return { backend, passwordless: readPasswordlessConfiguration(env) };
}

function readPasswordlessConfiguration(env: Readonly<Record<string, string | undefined>>): PasswordlessConfiguration {
  const appOrigin = readOrigin(env.AUTH_APP_ORIGIN, "AUTH_APP_ORIGIN");
  const magicLinkSecretText = readRequired(env.AUTH_MAGIC_LINK_SECRET, "AUTH_MAGIC_LINK_SECRET");
  const sessionSecretText = readRequired(env.AUTH_SESSION_SECRET, "AUTH_SESSION_SECRET");
  if (magicLinkSecretText.length < 32)
    throw configurationError("AUTH_MAGIC_LINK_SECRET", "AUTH_MAGIC_LINK_SECRET must contain at least 32 characters.");
  if (sessionSecretText.length < 32)
    throw configurationError("AUTH_SESSION_SECRET", "AUTH_SESSION_SECRET must contain at least 32 characters.");
  if (magicLinkSecretText === sessionSecretText)
    throw configurationError(
      "AUTH_MAGIC_LINK_SECRET",
      "AUTH_MAGIC_LINK_SECRET and AUTH_SESSION_SECRET must be different values.",
    );
  const turnstile = readTurnstileConfiguration(env);
  return {
    appOrigin,
    magicLinkSecret: new TextEncoder().encode(magicLinkSecretText),
    sessionSecret: new TextEncoder().encode(sessionSecretText),
    turnstile,
    magicLinkTtlSeconds: readInteger(env.AUTH_MAGIC_LINK_TTL_SECONDS, "AUTH_MAGIC_LINK_TTL_SECONDS", 900, 60, 3_600),
    accessTokenTtlSeconds: readInteger(
      env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      "AUTH_ACCESS_TOKEN_TTL_SECONDS",
      900,
      60,
      86_400,
    ),
    refreshTokenTtlSeconds: readInteger(
      env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      "AUTH_REFRESH_TOKEN_TTL_SECONDS",
      2_592_000,
      3_600,
      31_536_000,
    ),
  };
}

export function readTurnstileConfiguration(env: TurnstileEnvironment): TurnstileConfiguration {
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (!secretKey) return { secretKey: "" };
  const isTestingSecret = isCloudflareTestingSecret(secretKey);
  if (env.NODE_ENV === "production" && !isLocalHttpSelfHosted(env) && isTestingSecret)
    throw configurationError(
      "TURNSTILE_SECRET_KEY",
      "Cloudflare Turnstile testing keys are not allowed in production.",
    );
  const appOrigin = readOrigin(env.AUTH_APP_ORIGIN, "AUTH_APP_ORIGIN");
  return {
    secretKey,
    expectedAction: isTestingSecret ? "test" : "magic_link_request",
    expectedHostname: appOrigin.hostname,
  };
}

function isCloudflareTestingSecret(secretKey: string): boolean {
  return [
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
  ].includes(secretKey);
}

function isLocalHttpSelfHosted(env: Pick<TurnstileEnvironment, "WEB_ORIGIN" | "AUTH_APP_ORIGIN">): boolean {
  const origins = [env.WEB_ORIGIN, env.AUTH_APP_ORIGIN].filter((value): value is string => Boolean(value?.trim()));
  return origins.length > 0 && origins.every(isLocalHttpOrigin);
}

function isLocalHttpOrigin(value: string): boolean {
  try {
    const origin = new URL(value);
    return origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  } catch {
    return false;
  }
}

function readRequired(value: string | undefined, name: AuthConfigurationField): string {
  const normalized = value?.trim();
  if (!normalized) throw configurationError(name, `${name} is required for the selected authentication backend.`);
  return normalized;
}

function readInteger(
  value: string | undefined,
  name: AuthConfigurationField,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = value?.trim() || String(fallback);
  if (!/^\d+$/.test(raw))
    throw configurationError(name, `${name} must be an integer between ${minimum} and ${maximum}.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw configurationError(name, `${name} must be an integer between ${minimum} and ${maximum}.`);
  return parsed;
}

function readOrigin(value: string | undefined, name: AuthConfigurationField): URL {
  const parsed = readUrl(value, name);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw configurationError(name, `${name} must contain only an origin.`);
  return parsed;
}

function readUrl(value: string | undefined, name: AuthConfigurationField): URL {
  let parsed: URL;
  try {
    parsed = new URL(readRequired(value, name));
  } catch {
    throw configurationError(name, `${name} must be a valid URL.`);
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
  ) {
    throw configurationError(name, `${name} must use HTTPS.`);
  }
  return parsed;
}

function configurationError(field: AuthConfigurationField, message: string): AuthenticationConfigurationError {
  return new AuthenticationConfigurationError(field, message);
}
