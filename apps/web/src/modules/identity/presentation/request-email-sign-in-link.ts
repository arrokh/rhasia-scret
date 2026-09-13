export type PasswordlessSignInClient = {
  auth: {
    signInWithOtp(input: {
      email: string;
      options: { shouldCreateUser: true; emailRedirectTo: string };
    }): Promise<{ error: unknown }>;
  };
};

export type EmailSignInRequestResult = "sent" | "rate_limited" | "error";

export function authConfirmationRedirectUrl(origin: string): string {
  return new URL("/auth/confirm", origin).toString();
}

export async function requestEmailSignInLink(
  client: PasswordlessSignInClient,
  email: string,
  redirectTo: string,
): Promise<EmailSignInRequestResult> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
  });
  if (error === null) return "sent";
  return isRateLimited(error) ? "rate_limited" : "error";
}

function isRateLimited(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { status?: unknown }).status === 429;
}
