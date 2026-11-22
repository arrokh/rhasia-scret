export type PasswordlessClient = "web" | "pwa";
export type PasswordlessReturnPath = "/vaults" | "/vaults/invitations/redeem";

export function isSafePasswordlessChallengeExpirySeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 3_600;
}

export function isSafePwaHandoffId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function isSafePwaHandoffVerifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43,128}$/.test(value);
}
