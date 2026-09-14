import type { PasswordlessReturnPath } from "../application/passwordless-authentication";

export type PasswordlessSignInClient = {
  requestMagicLink(input: Readonly<{ email: string; returnPath: PasswordlessReturnPath }>): Promise<{
    error: unknown;
  }>;
};

export type EmailSignInRequestResult = "sent" | "rate_limited" | "error";

export async function requestEmailSignInLink(
  client: PasswordlessSignInClient,
  email: string,
  returnPath: PasswordlessReturnPath,
): Promise<EmailSignInRequestResult> {
  const { error } = await client.requestMagicLink({
    email: email.trim().toLowerCase(),
    returnPath,
  });
  if (error === null) return "sent";
  return isRateLimited(error) ? "rate_limited" : "error";
}

function isRateLimited(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { status?: unknown }).status === 429;
}
