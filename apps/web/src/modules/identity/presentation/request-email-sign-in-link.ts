import {
  isSafePasswordlessChallengeExpirySeconds,
  type PasswordlessClient,
  type PasswordlessReturnPath,
} from "../application/passwordless-client-contract";

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
    challengeExpiresInSeconds?: number;
  }>;
};

export type EmailSignInRequestResult = Readonly<
  | { status: "sent"; challengeExpiresInSeconds: number }
  | { status: "rate_limited" }
  | { status: "error"; definitivelyRejected: boolean }
>;

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
  const response = await client.requestMagicLink({
    email: email.trim().toLowerCase(),
    returnPath,
    ...(options ?? {}),
  });
  if (response.error !== null) {
    if (isRateLimited(response.error)) return { status: "rate_limited" };
    return { status: "error", definitivelyRejected: isDefinitiveHttpRejection(response.error) };
  }
  if (!isSafePasswordlessChallengeExpirySeconds(response.challengeExpiresInSeconds))
    return { status: "error", definitivelyRejected: false };
  return { status: "sent", challengeExpiresInSeconds: response.challengeExpiresInSeconds };
}

function isRateLimited(error: unknown): boolean {
  return getHttpStatus(error) === 429;
}

function isDefinitiveHttpRejection(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status !== null && status >= 400 && status < 500;
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}
