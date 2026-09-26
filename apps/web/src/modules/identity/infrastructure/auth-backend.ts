export type AuthBackend = "none" | "passwordless";
export type AuthConfigurationField =
  "AUTH_BACKEND" | "AUTH_APP_ORIGIN" | "AUTH_MOBILE_REDIRECT_URL" | "AUTH_SESSION_SECRET";

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

export type PasswordlessConfiguration = {
  appOrigin: URL;
  mobileRedirectUrl: URL;
};

export type AuthConfiguration =
  { backend: "none" } | { backend: "passwordless"; passwordless: PasswordlessConfiguration };

export function readAuthConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfiguration {
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
  return {
    appOrigin,
    mobileRedirectUrl: readMobileRedirectUrl(env.AUTH_MOBILE_REDIRECT_URL, appOrigin, env.NODE_ENV),
  };
}
function readRequired(value: string | undefined, name: AuthConfigurationField): string {
  const normalized = value?.trim();
  if (!normalized) throw configurationError(name, `${name} is required for the selected authentication backend.`);
  return normalized;
}

function readOrigin(value: string | undefined, name: AuthConfigurationField): URL {
  const parsed = readUrl(value, name);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw configurationError(name, `${name} must contain only an origin.`);
  return parsed;
}

function readMobileRedirectUrl(value: string | undefined, appOrigin: URL, nodeEnv: string | undefined): URL {
  if (!value?.trim()) return new URL("/auth/mobile", appOrigin);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw configurationError("AUTH_MOBILE_REDIRECT_URL", "AUTH_MOBILE_REDIRECT_URL must be a valid URL.");
  }
  const isDevelopmentCustomScheme =
    parsed.protocol === "rhasia-scret:" &&
    nodeEnv !== "production" &&
    parsed.hostname === "auth" &&
    parsed.port === "" &&
    parsed.pathname === "/magic-link";
  const isWebCallback =
    parsed.origin === appOrigin.origin && parsed.pathname === "/auth/mobile" && parsed.protocol === appOrigin.protocol;
  if (
    (!isDevelopmentCustomScheme && !isWebCallback) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw configurationError("AUTH_MOBILE_REDIRECT_URL", "AUTH_MOBILE_REDIRECT_URL is not an approved callback.");
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
