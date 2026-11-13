import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type {
  AuthStatePurgeResult,
  ExpiredAuthStateRepository,
} from "@api/modules/retention/application/auth-retention";

export class PrismaAuthRetentionRepository implements ExpiredAuthStateRepository {
  public constructor(private readonly database: PrismaDatabase) {}

  public async purgeExpiredAuthState(now: Date, batchSize: number, maxBatches: number): Promise<AuthStatePurgeResult> {
    let count = 0;
    let backlogRemaining = false;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const [challenges, handoffs, deletionChallenges, sessions, windows] = await this.database.$transaction([
        this.database.magicLinkChallenge.deleteMany({ where: { expiresAt: { lte: now } }, limit: batchSize }),
        this.database.pwaAuthenticationHandoff.deleteMany({ where: { expiresAt: { lte: now } }, limit: batchSize }),
        this.database.accountDeletionChallenge.deleteMany({ where: { expiresAt: { lte: now } }, limit: batchSize }),
        this.database.authSession.deleteMany({
          where: {
            OR: [{ refreshExpiresAt: { lte: now } }, { revokedAt: { not: null } }],
          },
          limit: batchSize,
        }),
        this.database.anonymousAuthRateLimitWindow.deleteMany({ where: { expiresAt: { lte: now } }, limit: batchSize }),
      ]);
      const batchCounts = [challenges.count, handoffs.count, deletionChallenges.count, sessions.count, windows.count];
      count += batchCounts.reduce((total, current) => total + current, 0);
      backlogRemaining = batchCounts.some((batchCount) => batchCount === batchSize);
      if (!backlogRemaining) return { count, backlogRemaining: false };
    }
    return { count, backlogRemaining };
  }
}
