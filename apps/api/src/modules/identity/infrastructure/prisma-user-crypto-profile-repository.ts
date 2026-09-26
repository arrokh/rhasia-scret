import { Prisma } from "@prisma/client";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type {
  EncryptedUserCryptoProfile,
  UserCryptoProfileRepository,
  UserEncryptionIdentity,
  UserRootKeyRewrap,
} from "../application/user-crypto-profile-repository";

export class PrismaUserCryptoProfileRepository implements UserCryptoProfileRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async get(userId: string): Promise<EncryptedUserCryptoProfile | null> {
    const profile = await this.database.userCryptoProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    return {
      vaultUnlockSalt: copyBytes(profile.vaultUnlockSalt),
      wrappedUserRootKey: copyBytes(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: copyBytes(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.rootKeyWrappingVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey
        ? (profile.userEncryptionPublicKey as JsonWebKey)
        : undefined,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey ? copyBytes(profile.encryptedUserPrivateKey) : undefined,
    };
  }

  public async registerUserEncryptionIdentity(userId: string, identity: UserEncryptionIdentity): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const updated = await tx.userCryptoProfile.updateMany({
        where: {
          userId,
          userEncryptionPublicKey: { equals: Prisma.DbNull },
          encryptedUserPrivateKey: null,
          userEncryptionKeyVersion: null,
        },
        data: {
          userEncryptionPublicKey: identity.publicKey as Prisma.InputJsonValue,
          encryptedUserPrivateKey: copyBytes(identity.encryptedPrivateKey),
          userEncryptionKeyVersion: identity.encryptionVersion,
        },
      });
      if (updated.count === 1) return true;
      const profile = await tx.userCryptoProfile.findUnique({ where: { userId }, select: { userId: true } });
      if (!profile) throw new Error("User crypto profile does not exist.");
      return false;
    });
  }

  public async rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void> {
    await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const updated = await tx.userCryptoProfile.updateMany({
        where: { userId },
        data: {
          vaultUnlockSalt: copyBytes(rewrap.vaultUnlockSalt),
          wrappedUserRootKey: copyBytes(rewrap.wrappedUserRootKey),
          rootKeyWrappingVersion: rewrap.encryptionVersion,
          ...(rewrap.encryptedPersonalVaultKey
            ? {
                encryptedPersonalVaultKey: copyBytes(rewrap.encryptedPersonalVaultKey),
                personalVaultKeyEncryptionVersion: rewrap.encryptionVersion,
              }
            : {}),
        },
      });
      if (updated.count !== 1) throw new Error("User crypto profile does not exist.");
    });
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
