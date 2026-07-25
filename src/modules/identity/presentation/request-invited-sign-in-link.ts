export type PasswordlessSignInClient = {
  auth: {
    signInWithOtp(input: {
      email: string;
      options: { shouldCreateUser: false; emailRedirectTo: string };
    }): Promise<{ error: unknown }>;
  };
};

export type InvitedSignInRequestResult = "sent" | "rate_limited" | "error";

export async function requestInvitedSignInLink(
  client: PasswordlessSignInClient,
  email: string,
  redirectTo: string
): Promise<InvitedSignInRequestResult> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo }
  });
  if (error === null) return "sent";
  return isRateLimited(error) ? "rate_limited" : "error";
}

function isRateLimited(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { status?: unknown }).status === 429;
}
