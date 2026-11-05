import { jwtVerify, SignJWT } from "jose";
import type { PasswordlessSession } from "../application/passwordless-authentication";
import { isSafeSessionId } from "../application/passwordless-authentication";
import type { PasswordlessConfiguration } from "./auth-backend";

export const PASSWORDLESS_ACCESS_COOKIE = "rhsia-passwordless-access";
export const PASSWORDLESS_REFRESH_COOKIE = "rhsia-passwordless-refresh";
export const PASSWORDLESS_ASSERTION_COOKIE = "rhsia-passwordless-assertion";
export const PASSWORDLESS_ASSERTION_ISSUER = "rhasia:passwordless-browser";
export const PASSWORDLESS_ASSERTION_AUDIENCE = "rhasia:web";
export const PASSWORDLESS_ASSERTION_TTL_SECONDS = 7 * 24 * 60 * 60;

type CookieOptions = Readonly<{
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: "/";
}>;

export type PasswordlessCookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): void;
};

export function passwordlessCookieOptions(maxAge: number, secure = true): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge,
    path: "/",
  };
}

export async function setPasswordlessSessionCookies(
  cookieStore: PasswordlessCookieStore,
  session: PasswordlessSession,
  configuration: PasswordlessConfiguration,
  now = new Date(),
): Promise<void> {
  cookieStore.set(
    PASSWORDLESS_ACCESS_COOKIE,
    session.accessToken,
    passwordlessCookieOptions(Math.max(1, Math.floor((session.accessExpiresAt.getTime() - now.getTime()) / 1_000))),
  );
  cookieStore.set(
    PASSWORDLESS_REFRESH_COOKIE,
    session.refreshToken,
    passwordlessCookieOptions(Math.max(1, Math.floor((session.refreshExpiresAt.getTime() - now.getTime()) / 1_000))),
  );
  cookieStore.set(
    PASSWORDLESS_ASSERTION_COOKIE,
    await signPasswordlessBrowserAssertion(
      configuration,
      session.sessionId,
      assertionExpiresAt(session.refreshExpiresAt, now),
      now,
    ),
    passwordlessCookieOptions(assertionMaxAgeSeconds(session.refreshExpiresAt, now)),
  );
}

export async function renewPasswordlessBrowserAssertionCookie(
  cookieStore: PasswordlessCookieStore,
  configuration: PasswordlessConfiguration,
  sessionId: string,
  sessionExpiresAt: Date,
  now = new Date(),
): Promise<void> {
  if (!isSafeSessionId(sessionId) || sessionExpiresAt.getTime() <= now.getTime())
    throw new Error("An active browser session is required.");
  cookieStore.set(
    PASSWORDLESS_ASSERTION_COOKIE,
    await signPasswordlessBrowserAssertion(configuration, sessionId, assertionExpiresAt(sessionExpiresAt, now), now),
    passwordlessCookieOptions(assertionMaxAgeSeconds(sessionExpiresAt, now)),
  );
}

export function clearPasswordlessSessionCookies(cookieStore: PasswordlessCookieStore): void {
  for (const name of [PASSWORDLESS_ACCESS_COOKIE, PASSWORDLESS_REFRESH_COOKIE, PASSWORDLESS_ASSERTION_COOKIE])
    cookieStore.set(name, "", passwordlessCookieOptions(0));
}

export async function signPasswordlessBrowserAssertion(
  configuration: PasswordlessConfiguration,
  sessionId: string,
  expiresAt: Date,
  now = new Date(),
): Promise<string> {
  if (!isSafeSessionId(sessionId)) throw new Error("Browser session identifier is invalid.");
  const maximumExpiry = new Date(now.getTime() + PASSWORDLESS_ASSERTION_TTL_SECONDS * 1_000);
  const boundedExpiry = expiresAt.getTime() < maximumExpiry.getTime() ? expiresAt : maximumExpiry;
  return new SignJWT({ session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PASSWORDLESS_ASSERTION_ISSUER)
    .setAudience(PASSWORDLESS_ASSERTION_AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(boundedExpiry.getTime() / 1_000))
    .sign(configuration.sessionSecret);
}

function assertionExpiresAt(sessionExpiresAt: Date, now: Date): Date {
  const maximumExpiry = new Date(now.getTime() + PASSWORDLESS_ASSERTION_TTL_SECONDS * 1_000);
  return sessionExpiresAt.getTime() < maximumExpiry.getTime() ? sessionExpiresAt : maximumExpiry;
}

function assertionMaxAgeSeconds(sessionExpiresAt: Date, now: Date): number {
  return Math.max(1, Math.floor((assertionExpiresAt(sessionExpiresAt, now).getTime() - now.getTime()) / 1_000));
}

export async function verifyPasswordlessBrowserAssertion(
  configuration: PasswordlessConfiguration,
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, configuration.sessionSecret, {
      issuer: PASSWORDLESS_ASSERTION_ISSUER,
      audience: PASSWORDLESS_ASSERTION_AUDIENCE,
    });
    const sessionId = payload.session_id;
    return typeof sessionId === "string" && isSafeSessionId(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}
