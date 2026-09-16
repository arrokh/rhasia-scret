export const PASSWORDLESS_ASSERTION_COOKIE = "rhsia-passwordless-assertion";
export const PASSWORDLESS_ASSERTION_ISSUER = "rhasia:passwordless-browser";
export const PASSWORDLESS_ASSERTION_AUDIENCE = "rhasia:web";

export function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
