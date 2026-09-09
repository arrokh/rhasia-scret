import { prisma } from "@/shared/infrastructure/prisma-client";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class PrismaPasskeyRecoveryRepository {
  public async issueChallenge(
    userId: string,
    purpose: "REGISTRATION" | "AUTHENTICATION",
    challenge: string,
  ): Promise<void> {
    await prisma.$transaction([
      prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId, purpose } }),
      prisma.passkeyRecoveryChallenge.create({
        data: { userId, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
      }),
    ]);
  }

  public async consumeChallenge(userId: string, purpose: "REGISTRATION" | "AUTHENTICATION"): Promise<string | null> {
    const record = await prisma.passkeyRecoveryChallenge.findFirst({
      where: { userId, purpose, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    await prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId, purpose } });
    return record?.challenge ?? null;
  }

  public async getCredential(userId: string) {
    return prisma.passkeyRecoveryCredential.findUnique({ where: { userId } });
  }

  public async saveCredential(
    userId: string,
    credentialId: Uint8Array,
    publicKey: Uint8Array,
    counter: bigint,
    transports: string[] | undefined,
    encryptedRecoveryPackage: Uint8Array,
  ): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const cryptoProfile = await transaction.userCryptoProfile.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (!cryptoProfile) throw new Error("User crypto profile does not exist.");
      await transaction.passkeyRecoveryCredential.upsert({
        where: { userId },
        create: {
          userId,
          credentialId: copyBytes(credentialId),
          publicKey: copyBytes(publicKey),
          counter,
          transports: transports ?? undefined,
          encryptedRecoveryPackage: copyBytes(encryptedRecoveryPackage),
        },
        update: {
          credentialId: copyBytes(credentialId),
          publicKey: copyBytes(publicKey),
          counter,
          transports: transports ?? undefined,
          encryptedRecoveryPackage: copyBytes(encryptedRecoveryPackage),
        },
      });
    });
  }

  public async updateCounter(userId: string, counter: bigint): Promise<void> {
    await prisma.passkeyRecoveryCredential.update({ where: { userId }, data: { counter } });
  }

  public async removeCredential(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.passkeyRecoveryChallenge.deleteMany({ where: { userId } }),
      prisma.passkeyRecoveryCredential.deleteMany({ where: { userId } }),
    ]);
  }
}
function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
