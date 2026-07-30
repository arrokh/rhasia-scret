import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/prisma-client";
import type { EncryptedUserCryptoProfile, UserCryptoProfileRepository, UserEncryptionIdentity, UserRootKeyRewrap } from "../application/user-crypto-profile-repository";

export class PrismaUserCryptoProfileRepository implements UserCryptoProfileRepository {
  public async get(userId: string): Promise<EncryptedUserCryptoProfile | null> {
    const profile = await prisma.userCryptoProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    return {
      vaultUnlockSalt: copyBytes(profile.vaultUnlockSalt),
      wrappedUserRootKey: copyBytes(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: copyBytes(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.rootKeyWrappingVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey ? profile.userEncryptionPublicKey as JsonWebKey : undefined,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey ? copyBytes(profile.encryptedUserPrivateKey) : undefined
    };
  }

  public async registerUserEncryptionIdentity(userId: string, identity: UserEncryptionIdentity): Promise<void> {
    const updated = await prisma.userCryptoProfile.updateMany({
      where: { userId },
      data: {
        userEncryptionPublicKey: identity.publicKey as Prisma.InputJsonValue,
        encryptedUserPrivateKey: copyBytes(identity.encryptedPrivateKey),
        userEncryptionKeyVersion: identity.encryptionVersion
      }
    });
    if (updated.count !== 1) throw new Error("User crypto profile does not exist.");
  }

  public async rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void> {
    const updated = await prisma.userCryptoProfile.updateMany({
      where: { userId },
      data: {
        vaultUnlockSalt: copyBytes(rewrap.vaultUnlockSalt),
        wrappedUserRootKey: copyBytes(rewrap.wrappedUserRootKey),
        rootKeyWrappingVersion: rewrap.encryptionVersion,
        ...(rewrap.encryptedPersonalVaultKey ? {
          encryptedPersonalVaultKey: copyBytes(rewrap.encryptedPersonalVaultKey),
          personalVaultKeyEncryptionVersion: rewrap.encryptionVersion
        } : {})
      }
    });
    if (updated.count !== 1) throw new Error("User crypto profile does not exist.");
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
