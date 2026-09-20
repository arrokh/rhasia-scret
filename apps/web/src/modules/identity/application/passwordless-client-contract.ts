export type PasswordlessClient = "web" | "mobile" | "pwa";
export type PasswordlessReturnPath = "/vaults" | "/vaults/invitations/redeem";

export function isSafePwaHandoffId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function isSafePwaHandoffVerifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43,128}$/.test(value);
}
