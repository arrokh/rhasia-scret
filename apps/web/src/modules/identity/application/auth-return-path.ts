export const DEFAULT_AUTH_RETURN_PATH = "/vaults";
export const INVITATION_AUTH_RETURN_PATH = "/vaults/invitations/redeem";
export const AUTH_COMPLETION_PATH = "/auth/complete";
export const AUTH_RETURN_PATH_COOKIE = "rhsia-auth-return-path";
export const AUTH_RETURN_PATH_COOKIE_MAX_AGE_SECONDS = 600;

export type AuthReturnPath = typeof DEFAULT_AUTH_RETURN_PATH | typeof INVITATION_AUTH_RETURN_PATH;

export function resolveAuthReturnPath(value: unknown): AuthReturnPath {
  return value === INVITATION_AUTH_RETURN_PATH ? INVITATION_AUTH_RETURN_PATH : DEFAULT_AUTH_RETURN_PATH;
}
