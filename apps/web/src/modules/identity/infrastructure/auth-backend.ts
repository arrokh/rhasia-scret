export type AuthBackend = "none" | "supabase" | "oidc";

export type OidcConfiguration = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: URL;
  audience?: string;
  sessionSecret: Uint8Array;
};

export type AuthConfiguration =
  { backend: "none" } | { backend: "supabase" } | { backend: "oidc"; oidc: OidcConfiguration };

export function readAuthConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfiguration {
  const backend = env.AUTH_BACKEND ?? "supabase";
  if (backend === "none" || backend === "supabase") return { backend };
  if (backend !== "oidc") throw new Error("AUTH_BACKEND must be none, supabase, or oidc.");
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

function readRequired(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the selected authentication backend.`);
  return value;
}

function readUrl(value: string | undefined, name: string, nodeEnv: string | undefined): URL {
  const parsed = new URL(readRequired(value, name));
  if (
    parsed.protocol !== "https:" &&
    !(nodeEnv !== "production" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))
  ) {
    throw new Error(`${name} must use HTTPS.`);
  }
  return parsed;
}
