import { prisma } from "@/shared/infrastructure/prisma-client";
import type { ExpiredAuthStateRepository } from "@/modules/retention/application/auth-retention";

export class PrismaAuthRetentionRepository implements ExpiredAuthStateRepository {
  public async purgeExpiredAuthState(now: Date): Promise<number> {
    const [challenges, handoffs, deletionChallenges, sessions, windows] = await prisma.$transaction([
      prisma.magicLinkChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
      prisma.pwaAuthenticationHandoff.deleteMany({ where: { expiresAt: { lte: now } } }),
      prisma.accountDeletionChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
      prisma.authSession.deleteMany({
        where: {
          OR: [{ refreshExpiresAt: { lte: now } }, { revokedAt: { not: null } }],
        },
      }),
      prisma.anonymousAuthRateLimitWindow.deleteMany({ where: { expiresAt: { lte: now } } }),
    ]);
    return challenges.count + handoffs.count + deletionChallenges.count + sessions.count + windows.count;
  }
}
