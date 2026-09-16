import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { ExpiredAuthStateRepository } from "@api/modules/retention/application/auth-retention";

export class PrismaAuthRetentionRepository implements ExpiredAuthStateRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async purgeExpiredAuthState(now: Date): Promise<number> {
    const [challenges, handoffs, deletionChallenges, sessions, windows] = await this.database.$transaction([
      this.database.magicLinkChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.database.pwaAuthenticationHandoff.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.database.accountDeletionChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.database.authSession.deleteMany({
        where: {
          OR: [{ refreshExpiresAt: { lte: now } }, { revokedAt: { not: null } }],
        },
      }),
      this.database.anonymousAuthRateLimitWindow.deleteMany({ where: { expiresAt: { lte: now } } }),
    ]);
    return challenges.count + handoffs.count + deletionChallenges.count + sessions.count + windows.count;
  }
}
