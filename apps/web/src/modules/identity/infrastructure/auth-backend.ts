export type AuthBackend = "none" | "passwordless" | "oidc";

export type PasswordlessConfiguration = {
  appOrigin: URL;
  mobileRedirectUrl: URL;
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
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfiguration {
  const backend = env.AUTH_BACKEND ?? "passwordless";
  if (backend === "none") return { backend };
  if (backend === "passwordless") return { backend, passwordless: readPasswordlessConfiguration(env) };
  if (backend !== "oidc") throw new Error("AUTH_BACKEND must be none, passwordless, or oidc.");
  const issuer = readUrl(env.OIDC_ISSUER, "OIDC_ISSUER", env.NODE_ENV);
  const redirectUri = readUrl(env.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI", env.NODE_ENV);
  const clientId = readRequired(env.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
  const clientSecret = readRequired(env.OIDC_CLIENT_SECRET, "OIDC_CLIENT_SECRET");
  const sessionSecretText = readRequired(env.OIDC_SESSION_SECRET, "OIDC_SESSION_SECRET");
  if (sessionSecretText.length < 32) throw new Error("OIDC_SESSION_SECRET must contain at least 32 characters.");
  if (redirectUri.protocol !== "https:" && env.NODE_ENV === "production")
    throw new Error("OIDC_REDIRECT_URI must use HTTPS in production.");
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

function readPasswordlessConfiguration(env: Readonly<Record<string, string | undefined>>): PasswordlessConfiguration {
  const appOrigin = readOrigin(env.AUTH_APP_ORIGIN, "AUTH_APP_ORIGIN", env.NODE_ENV);
  return {
    appOrigin,
    mobileRedirectUrl: readMobileRedirectUrl(env.AUTH_MOBILE_REDIRECT_URL, appOrigin, env.NODE_ENV),
  };
}
function readRequired(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for the selected authentication backend.`);
  return normalized;
}

function readOrigin(value: string | undefined, name: string, nodeEnv: string | undefined): URL {
  const parsed = readUrl(value, name, nodeEnv);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw new Error(`${name} must contain only an origin.`);
  return parsed;
}

function readMobileRedirectUrl(value: string | undefined, appOrigin: URL, nodeEnv: string | undefined): URL {
  if (!value?.trim()) return new URL("/auth/mobile", appOrigin);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("AUTH_MOBILE_REDIRECT_URL must be a valid URL.");
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
    throw new Error("AUTH_MOBILE_REDIRECT_URL is not an approved callback.");
  return parsed;
}

function readUrl(value: string | undefined, name: string, nodeEnv: string | undefined): URL {
  let parsed: URL;
  try {
    parsed = new URL(readRequired(value, name));
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (
    parsed.protocol !== "https:" &&
    !(nodeEnv !== "production" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))
  ) {
    throw new Error(`${name} must use HTTPS.`);
  }
  return parsed;
}
