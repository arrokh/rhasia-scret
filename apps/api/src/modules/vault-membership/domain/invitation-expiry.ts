export const SECURE_SHARE_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export function invitationExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SECURE_SHARE_LINK_LIFETIME_MS);
}

export function invitationIsExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
