export type AuthCallbackNotice = "access_denied" | "link_expired" | "verification_failed";

export function resolveAuthCallbackNotice(
  error: string | null,
  errorCode: string | null,
  errorDescription: string | null = null,
): AuthCallbackNotice | null {
  if (!error && !errorCode && errorDescription === null) return null;
  if (errorCode === "otp_expired") return "link_expired";
  if (error === "access_denied") return "access_denied";
  return "verification_failed";
}
