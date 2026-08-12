export type IncomingLinkKind = "auth_callback" | "secure_share_link" | "unknown";
export type AuthCallbackResult = "authenticated" | "invalid" | "provider_error";

export interface MobileAuthCallbackPort {
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ error: unknown }>;
}

export function classifyIncomingLink(rawUrl: string): IncomingLinkKind {
  const url = safeUrl(rawUrl);
  if (!url || !isTrustedOrigin(url)) return "unknown";
  const path = normalizedPath(url);
  if (path === "/auth/callback" || path === "/auth/mobile") return "auth_callback";
  if (path === "/vaults/invitations/redeem") return "secure_share_link";
  return "unknown";
}

export function extractSecureShareLinkSecret(rawUrl: string): string | null {
  if (classifyIncomingLink(rawUrl) !== "secure_share_link") return null;
  const url = safeUrl(rawUrl);
  const secret = url?.hash.startsWith("#") ? url.hash.slice(1) : "";
  return secret.length >= 16 && secret.length <= 4_096 ? secret : null;
}

export async function completeAuthCallback(rawUrl: string, auth: MobileAuthCallbackPort): Promise<AuthCallbackResult> {
  if (classifyIncomingLink(rawUrl) !== "auth_callback") return "invalid";
  const url = safeUrl(rawUrl);
  if (!url) return "invalid";
  if (url.searchParams.has("error") || fragmentParameters(url).has("error")) return "provider_error";
  const code = url.searchParams.get("code");
  if (code) return (await auth.exchangeCodeForSession(code)).error ? "provider_error" : "authenticated";
  const fragment = fragmentParameters(url);
  const accessToken = fragment.get("access_token") ?? url.searchParams.get("access_token");
  const refreshToken = fragment.get("refresh_token") ?? url.searchParams.get("refresh_token");
  if (!accessToken || !refreshToken) return "invalid";
  return (await auth.setSession({ access_token: accessToken, refresh_token: refreshToken })).error
    ? "provider_error"
    : "authenticated";
}

function safeUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isTrustedOrigin(url: URL): boolean {
  return url.protocol === "rhasia-scret:" || (url.protocol === "https:" && url.hostname === "rhasia-scret.vercel.app");
}

function normalizedPath(url: URL): string {
  if (url.protocol === "rhasia-scret:") return `/${url.hostname}${url.pathname}`.replace(/\/$/, "");
  return url.pathname.replace(/\/$/, "");
}

function fragmentParameters(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}
