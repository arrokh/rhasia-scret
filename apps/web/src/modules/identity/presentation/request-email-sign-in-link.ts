import type { PasswordlessClient, PasswordlessReturnPath } from "../application/passwordless-client-contract";

export type PasswordlessSignInClient = {
  requestMagicLink(
    input: Readonly<{
      email: string;
      returnPath: PasswordlessReturnPath;
      client?: PasswordlessClient;
      handoffId?: string;
      handoffVerifier?: string;
      turnstileToken?: string;
    }>,
  ): Promise<{
    error: unknown;
  }>;
};

export type EmailSignInRequestResult = "sent" | "rate_limited" | "error";

export async function requestEmailSignInLink(
  client: PasswordlessSignInClient,
  email: string,
  returnPath: PasswordlessReturnPath,
  options?: Readonly<{
    client?: PasswordlessClient;
    handoffId?: string;
    handoffVerifier?: string;
    turnstileToken?: string;
  }>,
): Promise<EmailSignInRequestResult> {
  const { error } = await client.requestMagicLink({
    email: email.trim().toLowerCase(),
    returnPath,
    ...(options ?? {}),
  });
  if (error === null) return "sent";
  return isRateLimited(error) ? "rate_limited" : "error";
}

function isRateLimited(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { status?: unknown }).status === 429;
}
