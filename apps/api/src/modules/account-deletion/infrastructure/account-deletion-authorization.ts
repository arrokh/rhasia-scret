import { constantTimeEqual, hmacSha256 } from "@api/shared/infrastructure/crypto";

export const ACCOUNT_DELETION_AUTHORIZATION_COOKIE = "rhsia-account-deletion-authorization";
export const ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE = "rhsia-account-deletion-oidc-challenge";

type DeletionCookieOptions = Readonly<{
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax";
  maxAge: number;
  path: "/";
}>;

export type DeletionCookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: DeletionCookieOptions): void;
};

export function deletionCookieOptions(maxAge: number, sameSite: "strict" | "lax" = "strict"): DeletionCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite,
    maxAge,
    path: "/",
  };
}

export function setDeletionAuthorizationCookie(cookieStore: DeletionCookieStore, token: string, maxAge: number): void {
  cookieStore.set(ACCOUNT_DELETION_AUTHORIZATION_COOKIE, token, deletionCookieOptions(maxAge));
}

export function setDeletionOidcChallengeCookie(cookieStore: DeletionCookieStore, challengeId: string): void {
  cookieStore.set(ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE, challengeId, deletionCookieOptions(600, "lax"));
}

export function clearDeletionCookies(cookieStore: DeletionCookieStore): void {
  for (const name of [ACCOUNT_DELETION_AUTHORIZATION_COOKIE, ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE])
    cookieStore.set(name, "", deletionCookieOptions(0));
}

export function digestDeletionValue(secret: Uint8Array, context: string, value: string): Uint8Array {
  return hmacSha256(secret, context, value);
}

export function equalDeletionValues(left: Uint8Array, right: Uint8Array): boolean {
  return constantTimeEqual(left, right);
}
