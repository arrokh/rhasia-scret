export type PasswordlessSignInClient = {
  auth: {
    signInWithOtp(input: {
      email: string;
      options: { shouldCreateUser: false; emailRedirectTo: string };
    }): Promise<{ error: unknown }>;
  };
};

export async function requestInvitedSignInLink(
  client: PasswordlessSignInClient,
  email: string,
  redirectTo: string
): Promise<boolean> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo }
  });
  return error === null;
}
