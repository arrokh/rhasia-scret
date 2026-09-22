export type AuthBackend = "none" | "passwordless" | "oidc";
export type AuthConfigurationField =
  | "AUTH_BACKEND"
  | "AUTH_APP_ORIGIN"
  | "AUTH_MOBILE_REDIRECT_URL"
  | "AUTH_MAGIC_LINK_SECRET"
  | "AUTH_SESSION_SECRET"
  | "AUTH_MAGIC_LINK_TTL_SECONDS"
  | "AUTH_ACCESS_TOKEN_TTL_SECONDS"
  | "AUTH_REFRESH_TOKEN_TTL_SECONDS"
  | "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
  | "TURNSTILE_SECRET_KEY"
  | "OIDC_ISSUER"
  | "OIDC_CLIENT_ID"
  | "OIDC_CLIENT_SECRET"
  | "OIDC_REDIRECT_URI"
  | "OIDC_SESSION_SECRET";

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

export type TurnstileConfiguration = {
  siteKey: string;
  secretKey: string;
};

export type PasswordlessConfiguration = {
  appOrigin: URL;
  mobileRedirectUrl: URL;
  magicLinkSecret: Uint8Array;
  sessionSecret: Uint8Array;
  turnstile: TurnstileConfiguration;
  magicLinkTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

export type OidcConfiguration = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: URL;
  audience?: string;
  sessionSecret: Uint8Array;
};

export type AuthConfiguration =
  | { backend: "none" }
  | { backend: "passwordless"; passwordless: PasswordlessConfiguration }
  | { backend: "oidc"; oidc: OidcConfiguration };

export function readAuthConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ requireTurnstileSiteKey?: boolean }> = {},
): AuthConfiguration {
  const configuredBackend = env.AUTH_BACKEND?.trim();
  if (!configuredBackend && env.NODE_ENV === "production")
    throw configurationError("AUTH_BACKEND", "AUTH_BACKEND must be set explicitly in production.");
  const backend = configuredBackend || "passwordless";
  if (backend === "none") return { backend };
  if (backend === "passwordless") return { backend, passwordless: readPasswordlessConfiguration(env, options) };
  if (backend !== "oidc") throw configurationError("AUTH_BACKEND", "AUTH_BACKEND must be none, passwordless, or oidc.");
  const issuer = readUrl(env.OIDC_ISSUER, "OIDC_ISSUER");
  const redirectUri = readUrl(env.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI");
  const clientId = readRequired(env.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
  const clientSecret = readRequired(env.OIDC_CLIENT_SECRET, "OIDC_CLIENT_SECRET");
  const sessionSecretText = readRequired(env.OIDC_SESSION_SECRET, "OIDC_SESSION_SECRET");
  if (sessionSecretText.length < 32)
    throw configurationError("OIDC_SESSION_SECRET", "OIDC_SESSION_SECRET must contain at least 32 characters.");
  return {
    backend,
    oidc: {
      issuer,
      clientId,
      clientSecret,
      redirectUri,
      audience: env.OIDC_AUDIENCE || undefined,
      sessionSecret: new TextEncoder().encode(sessionSecretText),
    },
  };
}

function readPasswordlessConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ requireTurnstileSiteKey?: boolean }>,
): PasswordlessConfiguration {
  const appOrigin = readOrigin(env.AUTH_APP_ORIGIN, "AUTH_APP_ORIGIN");
  const mobileRedirectUrl = readMobileRedirectUrl(env.AUTH_MOBILE_REDIRECT_URL, appOrigin, env.NODE_ENV);
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
  const turnstile = readTurnstileConfiguration(env, env.NODE_ENV, options.requireTurnstileSiteKey ?? true);
  return {
    appOrigin,
    mobileRedirectUrl,
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

function readTurnstileConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string | undefined,
  requireSiteKey: boolean,
): TurnstileConfiguration {
  const siteKey = requireSiteKey
    ? readRequired(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "NEXT_PUBLIC_TURNSTILE_SITE_KEY")
    : "";
  const secretKey = readRequired(env.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
  if (
    nodeEnv === "production" &&
    !isLocalHttpSelfHosted(env) &&
    (siteKey === "1x00000000000000000000AA" || secretKey === "1x0000000000000000000000000000000AA")
  )
    throw configurationError(
      "TURNSTILE_SECRET_KEY",
      "Cloudflare Turnstile testing keys are not allowed in production.",
    );
  return { siteKey, secretKey };
}

function isLocalHttpSelfHosted(env: Readonly<Record<string, string | undefined>>): boolean {
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
