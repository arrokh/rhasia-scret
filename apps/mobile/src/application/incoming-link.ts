export type IncomingLinkKind = "magic_link" | "secure_share_link" | "unknown";
export type AuthCallbackResult = "authenticated" | "invalid" | "provider_error";

export interface MobilePasswordlessAuthPort {
  redeemMagicLink(token: string): Promise<unknown>;
}

export function classifyIncomingLink(rawUrl: string, webOrigin: string): IncomingLinkKind {
  const url = safeUrl(rawUrl);
  if (!url || url.username || url.password || url.search || !isTrustedOrigin(url, webOrigin)) return "unknown";
  const path = normalizedPath(url);
  if (path === "/auth/mobile" || (url.protocol === "rhasia-scret:" && path === "/auth/magic-link")) return "magic_link";
  if (path === "/vaults/invitations/redeem") return "secure_share_link";
  return "unknown";
}

export function extractMagicLinkToken(rawUrl: string, webOrigin: string): string | null {
  if (classifyIncomingLink(rawUrl, webOrigin) !== "magic_link") return null;
  const url = safeUrl(rawUrl);
  const token = fragmentParameters(url ?? new URL("https://invalid.example")).get("token");
  return token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
}

export function extractSecureShareLinkSecret(rawUrl: string, webOrigin: string): string | null {
  if (classifyIncomingLink(rawUrl, webOrigin) !== "secure_share_link") return null;
  const url = safeUrl(rawUrl);
  const secret = url?.hash.startsWith("#") ? url.hash.slice(1) : "";
  return /^[A-Za-z0-9_-]{16,4096}$/.test(secret) ? secret : null;
}

export async function completeMagicLink(
  rawUrl: string,
  auth: MobilePasswordlessAuthPort,
  webOrigin: string,
): Promise<AuthCallbackResult> {
  const token = extractMagicLinkToken(rawUrl, webOrigin);
  if (!token) return "invalid";
  try {
    await auth.redeemMagicLink(token);
    return "authenticated";
  } catch {
    return "provider_error";
  }
}

function safeUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isTrustedOrigin(url: URL, webOrigin: string): boolean {
  return url.protocol === "rhasia-scret:"
    ? url.hostname === "auth" && url.port === ""
    : url.protocol === "https:" && url.origin === webOrigin;
}

function normalizedPath(url: URL): string {
  if (url.protocol === "rhasia-scret:") return `/${url.hostname}${url.pathname}`.replace(/\/$/, "");
  return url.pathname.replace(/\/$/, "");
}

function fragmentParameters(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}
